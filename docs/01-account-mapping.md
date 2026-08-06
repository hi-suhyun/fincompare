# Phase 0 — 계정과목 매핑 · 기간 정규화 · 지표 계산식 설계

`00-data-sources.md`의 조사 결과를 전제로 한다.

---

## 1. 내부 표준 스키마

모든 외부 소스는 어댑터를 거쳐 아래 한 가지 형태로만 저장된다.

```ts
type MetricId =
  // 절대값 (BASE — 소스에서 직접 가져오는 값)
  | 'revenue'              // 매출액
  | 'operatingIncome'      // 영업이익
  | 'netIncome'            // 당기순이익 (지배주주 귀속)
  | 'netIncomeTotal'       // 당기순이익 (비지배지분 포함)
  | 'totalAssets'          // 자산총계
  | 'totalLiabilities'     // 부채총계
  | 'totalEquity'          // 자본총계 (비지배지분 포함)
  | 'equityControlling'    // 지배주주지분 자본
  // 주식 (BASE)
  | 'sharesOutstanding'    // 보통주 유통주식수
  // 시장 (BASE)
  | 'closePrice';          // 기말 종가

type DerivedMetricId =
  | 'operatingMargin' | 'netMargin' | 'roe' | 'debtRatio'
  | 'eps' | 'bps' | 'per' | 'pbr' | 'marketCap';

interface FinancialDataPoint {
  companyId: string;
  metricId: MetricId;
  periodType: 'FY' | 'Q';
  periodStart: string | null;   // ISO date. BS 항목은 null (시점 데이터)
  periodEnd: string;            // ISO date. 정렬의 기준
  fiscalYear: number;           // 기업이 보고한 회계연도 (NVDA FY2022)
  fiscalQuarter: 1|2|3|4|null;
  alignedYear: number;          // 비교용 정렬 연도 (NVDA FY2022 → 2021)
  alignedQuarter: 1|2|3|4|null;
  value: number | null;         // 결측은 명시적 null. 0으로 절대 채우지 않음
  currency: 'KRW' | 'USD';
  consolidation: 'CFS' | 'OFS'; // 연결/별도
  source: 'DART' | 'SEC' | 'KRX' | 'TIINGO' | 'NAVER';
  sourceTag: string;            // 원본 태그 (ifrs-full_Revenue, OperatingIncomeLoss 등)
  filedAt: string | null;
}
```

`value`가 `null`인 것과 **행 자체가 없는 것**을 구분한다.
- 행 없음 = 아직 조회 안 함 → 조회 대상
- `value: null` = 조회했는데 그 기업이 그 항목을 공시하지 않음 → 재조회 안 함, 화면에 "데이터 없음"

---

## 2. 계정과목 매핑 테이블

### 2.1 매핑 원칙

1. **`account_id`(DART) / XBRL 태그(SEC)를 1순위 키로 쓴다.** 계정명(`account_nm`) 문자열
   매칭은 최후 폴백. 기업마다 표기가 다르기 때문("매출액" / "수익(매출액)" / "영업수익").
2. **후보 태그를 우선순위 배열로 둔다.** 첫 번째로 값이 존재하는 태그를 채택하고,
   어느 태그가 채택됐는지 `sourceTag`에 기록한다 (디버깅·신뢰도 표시용).
3. **매핑 실패는 조용히 0이 되면 안 된다.** `null` + 경고 로그.

### 2.2 K-IFRS (DART) → 내부 스키마

| 내부 metricId | 1순위 `account_id` | 폴백 | 재무제표 |
|---|---|---|---|
| `revenue` | `ifrs-full_Revenue` | `ifrs-full_RevenueFromSaleOfGoods`, 계정명 `매출액\|수익\|영업수익` | IS/CIS |
| `operatingIncome` | **`dart_OperatingIncomeLoss`** | 계정명 `영업이익` | IS/CIS |
| `netIncome` | `ifrs-full_ProfitLossAttributableToOwnersOfParent` | 계정명 `지배기업.*소유주.*순이익` | IS/CIS |
| `netIncomeTotal` | `ifrs-full_ProfitLoss` | 계정명 `당기순이익` | IS/CIS |
| `totalAssets` | `ifrs-full_Assets` | 계정명 `자산총계` | BS |
| `totalLiabilities` | `ifrs-full_Liabilities` | 계정명 `부채총계` | BS |
| `totalEquity` | `ifrs-full_Equity` | 계정명 `자본총계` | BS |
| `equityControlling` | `ifrs-full_EquityAttributableToOwnersOfParent` | 계정명 `지배기업.*소유주지분` | BS |

⚠️ **`영업이익`은 IFRS 표준 태그가 없다.** IFRS는 영업이익 표시를 강제하지 않아서
한국은 금융감독원 확장 태그 `dart_OperatingIncomeLoss`를 쓴다. `ifrs-full_` 접두어로만
찾으면 영업이익이 통째로 빠진다.

### 2.3 US GAAP (SEC) → 내부 스키마

| 내부 metricId | 태그 우선순위 |
|---|---|
| `revenue` | `RevenueFromContractWithCustomerExcludingAssessedTax` → `Revenues` → `RevenueFromContractWithCustomerIncludingAssessedTax` → `SalesRevenueNet`(2018 이전) |
| `operatingIncome` | `OperatingIncomeLoss` |
| `netIncome` | `NetIncomeLoss` |
| `netIncomeTotal` | `ProfitLoss` → `NetIncomeLoss` |
| `totalAssets` | `Assets` |
| `totalLiabilities` | `Liabilities` → *(파생)* `Assets − StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| `totalEquity` | `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` → `StockholdersEquity` |
| `equityControlling` | `StockholdersEquity` |
| `sharesOutstanding` | `dei:EntityCommonStockSharesOutstanding` → `CommonStockSharesOutstanding` → `WeightedAverageNumberOfDilutedSharesOutstanding` |

### 2.4 반드시 짚고 갈 등가관계 — 여기가 국가 간 비교의 핵심

```
US GAAP  NetIncomeLoss   ≡  K-IFRS  ProfitLossAttributableToOwnersOfParent   (지배주주순이익)
US GAAP  ProfitLoss      ≡  K-IFRS  ProfitLoss                              (연결 총 순이익)

US GAAP  StockholdersEquity                                   ≡  K-IFRS  EquityAttributableToOwnersOfParent
US GAAP  StockholdersEquityIncluding...NoncontrollingInterest  ≡  K-IFRS  Equity
```

US GAAP의 `NetIncomeLoss`는 **이미 비지배지분을 제외한 값**이고,
`StockholdersEquity`도 **이미 지배주주지분만**이다. 이름만 보면 "총액"처럼 보여서
K-IFRS `ProfitLoss`(총 순이익)와 짝지어 버리기 쉽다. 그렇게 하면
비지배지분이 큰 기업(지주회사, 합작 많은 제조사)의 ROE·PER이 국가별로 체계적으로 왜곡된다.

**규칙: ROE와 EPS·PER은 항상 지배주주 기준(`netIncome`, `equityControlling`)으로 계산한다.**

### 2.5 비교 가능성 경고 (UI에 노출할 것)

| 항목 | 이슈 | 처리 |
|---|---|---|
| 영업이익 | K-IFRS는 금융손익·지분법손익 제외. US GAAP `OperatingIncomeLoss`는 기업별로 구조조정비·손상차손 포함 여부가 다름 | 지표 옆 ⓘ 툴팁으로 고지 |
| 영업이익 미태깅 | 은행·보험 등 상당수 미국 금융사는 `OperatingIncomeLoss`를 태깅하지 않음 | `null` → "데이터 없음" |
| 매출 태그 전환 | ASC 606(2018) 전후로 `SalesRevenueNet` → `RevenueFromContractWithCustomer...`로 변경 | 우선순위 배열로 흡수. 2017/2018 경계 연속성 테스트 필수 |
| 연결 vs 별도 | DART는 `CFS`/`OFS` 선택. SEC는 항상 연결 | **`CFS` 고정**, 없을 때만 `OFS` 폴백 + 배지 표시 |

---

## 3. 기간 정규화 — 결산월이 다른 기업 정렬

### 3.1 문제

| 기업 | 결산월 | FY2025의 실제 기간 |
|---|---|---|
| 삼성전자 | 12월 | 2025-01-01 ~ 2025-12-31 |
| Apple | 9월 | 2024-09-29 ~ 2025-09-27 |
| NVIDIA | 1월 | 2024-01-29 ~ 2025-01-26 |

라벨만 믿고 "FY2025"끼리 겹치면 NVIDIA는 사실상 2024년 실적이 2025년 자리에 찍힌다.

### 3.2 정렬 규칙 (채택)

> **연간**: `alignedYear` = (periodEnd **− 3개월**)이 속한 달력 연도
> **분기**: `alignedYear`/`alignedQuarter` = (periodEnd **− 45일**)이 속한 달력 분기

즉 결산월 **4~12월 → 당해 연도, 1~3월 → 직전 연도**.

실데이터 검증 — SEC 자체 `frame` 값과 6개 케이스 전부 일치:

| 기업 | 결산월 | periodEnd | −3M | alignedYear | SEC frame | 일치 |
|---|---|---|---|---|---|---|
| AAPL | 9월 | 2025-09-27 | 2025-06 | **2025** | CY2025 | ✅ |
| AAPL | 9월 | 2024-09-28 | 2024-06 | **2024** | CY2024 | ✅ |
| NVDA | 1월 | 2022-01-30 | 2021-10 | **2021** | CY2021 | ✅ |
| NVDA | 1월 | 2017-01-29 | 2016-10 | **2016** | CY2016 | ✅ |
| MSFT | 6월 | 2008-06-30 | 2008-03 | **2008** | CY2008 | ✅ |
| MSFT | 6월 | 2010-06-30 | 2010-03 | **2010** | CY2010 | ✅ |

분기 검증 (AAPL):

| periodEnd | −45일 | aligned | SEC frame |
|---|---|---|---|
| 2025-12-27 | 2025-11-12 | **2025Q4** | CY2025Q4 ✅ |
| 2026-03-28 | 2026-02-11 | **2026Q1** | CY2026Q1 ✅ |
| 2026-06-27 | 2026-05-13 | **2026Q2** | CY2026Q2 ✅ |

⚠️ **처음에 `−6개월`(기간 중간점) 규칙을 채택했다가 폐기했다.** 6월 결산인 MSFT의
FY2008(2007-07-01 ~ 2008-06-30)을 중간점 규칙은 CY2007로 보내는데, SEC는 CY2008로 배정한다.
달력일수로는 2007년이 184일, 2008년이 182일이라 "많이 겹치는 해"조차 2007년이지만
SEC는 그렇게 하지 않는다. `−3개월` 규칙이 검증된 6개 케이스 전부와 맞는다.

6월 결산 기업은 어느 해로 보내든 절반씩 걸치는 본질적 모호함이 있으므로,
**툴팁에 실제 회계기간을 항상 병기**해서 사용자가 직접 판단할 수 있게 한다.

### 3.3 UI 규칙

- X축은 `alignedYear`를 쓴다.
- 툴팁에는 **실제 회계기간을 함께 보여준다**: `NVDA FY2022 (2021.02–2022.01)`
- 결산월이 12월이 아닌 기업은 범례에 작은 배지 (`9월 결산`)를 단다.
  사용자가 "왜 이렇게 정렬됐지"를 물을 필요가 없게 만드는 게 목적이다.

### 3.4 TTM

분기 모드에서 TTM = 직전 4개 분기 **합산**. 단,
- 손익(revenue/operatingIncome/netIncome)만 합산 대상
- 재무상태(assets/liabilities/equity)는 **시점 데이터라 합산하지 않는다** → 최근 분기 값 사용
- 4개 분기 중 하나라도 `null`이면 TTM은 `null` (부분 합산 금지)

---

## 4. 통화 환산

- 저장은 **원화폐 그대로** (`currency` 필드 유지). 환산은 조회 시점에 수행.
- 손익(flow) 항목 → **해당 회계기간의 평균 환율**
- 재무상태(stock) 항목·주가 → **기말 시점 환율**
- 환율 결측(주말/공휴일) → 직전 영업일 forward-fill
- 정규화 모드(시작=100)에서는 **환산을 적용하지 않는다.** 성장률 비교에 환율 변동이 섞이면
  기업 성과가 아니라 환율을 보게 된다. UI에 이 사실을 명시한다.

---

## 5. 지표 계산식 (단위 테스트 대상)

모든 식은 `packages/shared/src/metrics/`에 순수 함수로 둔다.
분모가 0이거나 어느 한쪽이 `null`이면 결과는 `null`.

```
operatingMargin = operatingIncome / revenue
netMargin       = netIncome / revenue
debtRatio       = totalLiabilities / totalEquity          // 한국식 부채비율

roe             = netIncome / avg(equityControlling_기초, equityControlling_기말)
                  // 기초값 없으면 기말값 사용 + degraded 플래그

eps             = 공시값 그대로 사용  ← 계산하지 않는다 (아래 5.1 참고)
bps             = equityControlling / sharesTotal          // EPS 와 같은 분모
per             = closePrice / eps                         // eps <= 0 이면 null (적자 PER 무의미)
pbr             = closePrice / bps
marketCap       = closePrice * sharesOutstanding            // 보통주 기준
```

### 5.1 EPS 는 절대 직접 계산하지 않는다 (실측으로 발견)

처음 설계에서 `EPS = 지배주주순이익 / 보통주 유통주식수`로 잡았다가 **틀린 것을 확인**했다.

삼성전자 2023 실측:

| 계산 방식 | 결과 | 판정 |
|---|---|---|
| 지배주주순이익 ÷ **보통주** (5,969,782,550) | 2,424원 | ❌ **공시 대비 +13.7%** |
| 지배주주순이익 ÷ **보통주+우선주** (6,792,669,250) | 2,131원 | ✅ 공시값과 일치 |
| **DART 공시값** `ifrs-full_BasicEarningsLossPerShare` | **2,131원** | ← 이것을 쓴다 |

원인은 **참가적 우선주**다. 삼성전자우(005935)는 보통주와 이익을 나눠 갖기 때문에
K-IFRS 기본주당이익이 총 주식수 기준으로 배분된다. 배분 규칙은 기업마다 다르고
(비참가적·누적적 여부, 전환권, 자기주식 변동) 우리가 재현할 방법이 없다.

**결정:**

1. `eps` 를 **BASE 지표로 승격**하고 공시 태그에서 그대로 읽는다
   - K-IFRS: `ifrs-full_BasicEarningsLossPerShare`
   - US GAAP: `EarningsPerShareBasic`
2. 직접 계산(`estimateEps`)은 공시값이 없을 때의 **폴백**으로만 쓰고,
   분모는 **총 주식수(보통주+우선주)**를 쓴다. 화면에는 "추정치" 표시를 붙인다
3. `BPS` 도 같은 분모(총 주식수)를 쓴다. 분모가 다르면 PER 과 PBR 이
   서로 다른 기준이 되어 나란히 놓고 볼 수 없다
4. `sharesTotal` 을 BASE 지표에 추가한다

PER 이 12% 낮게 나오는 오차는 30년 경력 투자자가 화면을 보자마자 알아채는 크기다
(`03-user-context.md` 2.3).

**테스트 케이스 목록 (Phase 1에서 작성):**

- 정상 케이스 (삼성전자 2023 실측값 대조)
- `null` 전파: 분자·분모 어느 쪽이 null이어도 결과 null
- 0 분모: `revenue = 0` → null (`Infinity` 금지)
- 적자 PER: `eps < 0` → null
- ROE 기초자본 결측 시 기말값 폴백 + 플래그
- TTM 부분 결측 → null
- 환율 forward-fill 경계 (금요일 종가 → 토·일)
- `alignedYear` 계산: 12월/9월/1월/6월 결산 각각
- ASC 606 전환 구간(2017→2018) 매출 태그 폴백 연속성
- 비지배지분 큰 기업의 ROE가 `equityControlling` 기준인지

---

## 5.2 실데이터에서 추가로 드러난 매핑 문제 3가지

Phase 1 구현 중 실제 DART 응답으로 확인한 것들이다. 픽스처 하나로는 안 보이고
여러 기업·여러 연도를 돌려야 나온다.

### (A) IFRS 택사노미 접두어가 2019년에 바뀐다

```
2017년 보고서:  ifrs_ProfitLossAttributableToOwnersOfParent
2023년 보고서:  ifrs-full_ProfitLossAttributableToOwnersOfParent
```

이걸 놓쳐서 `netIncome`·`eps`·`equityControlling` 이 **2015~2018 구간에서 통째로 비었다.**
매출액과 영업이익만 나오고 ROE·PER 은 앞 4년이 빈 차트가 됐다.

매핑 테이블마다 두 태그를 나열하면 새 지표를 추가할 때 반드시 한쪽을 빠뜨린다.
규칙이 기계적이므로 **리졸버에서 자동 확장**한다 (`expandTaxonomyVariants`).

### (B) 표준계정코드를 안 쓰는 기업이 있다

현대차는 `account_id` 가 `-표준계정코드 미사용-` 이고 계정명만 있다.
그리고 **우선주가 있는 기업은 보통주·우선주 EPS 를 따로 공시한다**:

```
삼성전자   '기본주당이익(손실)'        2,131원   ← 보통주·우선주 통합 배분
현대차     '보통주 기본주당이익'      28,521원   ← 이것을 써야 한다
          '1우선주 기본주당이익'     28,207원   ← 집으면 PER 이 조용히 어긋난다
```

계정명 폴백 패턴을 `/^(?!.*우선주)(보통주\s*)?기본주당(순)?이익/` 로 두어
우선주 EPS 를 배제한다. 폴백을 쓴 경우 `usedNameFallback` 로 기록해 신뢰도를 추적한다.

### (C) 액면분할 — 주당 지표의 불연속

삼성전자 2018년 5월 50:1 액면분할:

```
2017  EPS 299,868원
2018  EPS   6,461원   ← 98% 폭락처럼 보인다
```

주당 지표는 각 시점 공시값이라 액면 기준이 다르다. 조정 없이 한 차트에 그리면
**이익이 증발한 것처럼 읽힌다.**

**현재 대응 (Phase 1)**: 주식수 급변을 감지해 경고를 띄운다 (`detectSplits`).
삼성전자 사례를 49.9배로 잡아낸다. 유상증자와 구분하려면 자본금 변화를 함께 본다 —
액면분할은 주식수만 늘고 자본금은 그대로다.

**남은 작업 (Phase 5)**: 과거 값을 현재 액면 기준으로 환산하는 정식 조정.
주가도 같은 조정이 필요하므로 주가 연동과 함께 처리하는 게 자연스럽다.

### (D) SEC 응답은 전체를 검증하면 안 된다

`companyfacts` 는 기업당 3.8MB / 500개 개념이고, 우리가 읽는 태그는 15개뿐이다.
문서 전체를 엄격히 검증했더니 **Intel 이 통째로 실패**했다 — 원인은 우리가 쓰지도 않는
`ffd` 택사노미(증권신고서 수수료)의 행이었다:

```json
{"end":"2026-04-28","val":895129.67,"fy":null,"fp":null,"form":"424B5"}
```

`fy: null` 이라 `z.number().optional()` 이 거부한다. 쓰지도 않는 개념 하나 때문에
기업 전체 재무데이터가 날아가는 구조였다.

**대응**: 최상위는 느슨하게 받고(`facts: Record<string, Record<string, unknown>>`),
개념 검증은 실제로 읽을 때 `readConcept()` 에서 한다. 형태가 다르면 그 태그만 건너뛴다.
검증 비용도 크게 줄었다.

### (E) 같은 기간이 여러 보고서에 반복해서 실린다

AAPL FY2021 매출은 세 번 나온다 — 원 보고서(2021-10-29 제출)와 이후 두 번의 비교표시.
`fy` 값이 각각 2021 / 2022 / 2023 이다.

**대응**: `filed` 가 가장 이른 것(원 보고서)을 택한다.
DART 쪽을 "각 연도 사업보고서 공시값"으로 맞췄으므로 기준을 통일한다.
재작성 반영값을 쓰고 싶으면 `collectByYear()` 의 비교 방향만 뒤집으면 된다.

---

## 6. 어댑터 인터페이스

```ts
interface FinancialsAdapter {
  readonly source: SourceId;
  supports(company: Company): boolean;
  fetchAnnual(company: Company, from: number, to: number): Promise<FinancialDataPoint[]>;
  fetchQuarterly(company: Company, from: number, to: number): Promise<FinancialDataPoint[]>;
}

interface PriceAdapter {
  readonly source: SourceId;
  supports(company: Company): boolean;
  // 월말/분기말 종가만 필요 — 일별 전체를 받지 않는다
  fetchPeriodEndCloses(company: Company, dates: string[]): Promise<PricePoint[]>;
}

interface FxAdapter {
  fetchRates(base: Currency, quote: Currency, from: string, to: string): Promise<FxRate[]>;
}
```

시장 추가(일본·유럽)는 `FinancialsAdapter` + `PriceAdapter` 구현체 추가만으로 끝나야 한다.
`Company.market` 값과 어댑터 `supports()`로 라우팅한다.
