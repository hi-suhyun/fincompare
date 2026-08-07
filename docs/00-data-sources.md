# Phase 0 — 데이터 소스 조사 결과

조사일: 2026-08-05
검증 방법: 각 API를 실제로 호출하거나 공식 문서 페이지를 직접 열람. 아래 "검증" 열에
`실호출` 표시가 있는 항목은 이 문서 작성 중 실제 HTTP 요청으로 응답을 확인한 것이다.

---

## 0. 요약 — 최종 권장 조합

| 레이어 | 권장 소스 | 상태 |
|---|---|---|
| 국내 재무제표 | **DART OpenAPI** `fnlttSinglAcntAll` | 확정 |
| 국내 발행주식수 | **DART OpenAPI** `stockTotqySttus` | 확정 |
| 미국 재무제표 | **SEC EDGAR** `data.sec.gov/api/xbrl/companyfacts` | 확정 (실호출 검증) |
| 환율 | **Frankfurter (ECB)** `api.frankfurter.dev` | 확정 (실호출 검증) |
| 국내 주가 | **KRX Open API** (공식) | 확정 (실호출 검증) |
| 미국 주가 | **미사용** | 확정 — 무료 티어가 전부 재배포 금지 (3.4절) |

### 결정 기록

| 일자 | 결정 | 근거 |
|---|---|---|
| 2026-08-05 | 배포 범위 = **가족 전용 URL** | 할아버지가 북마크로 여실 수 있어야 한다 |
| 2026-08-06 | 국내 주가 = **KRX Open API** | 공식·무료. **미조정 실거래가**라 액면분할 조정이 불필요 |
| 2026-08-06 | **미국 주가 미사용** | 무료 티어가 예외 없이 "다른 사람에게 표시·공유" 를 금지한다. 유료도 재배포는 별도 가격 |

**결과적으로 전부 무료이고 라이선스가 깨끗하다.**
빠지는 것은 미국 기업의 PER·PBR 뿐이고, 국내는 밸류에이션까지 전부 나온다.
할아버지가 요청하신 영업이익 비교는 국내·미국 모두 정상 동작한다.

---

## 1. 프롬프트에 적힌 가정 검증 결과

| # | 가정 | 검증 결과 |
|---|---|---|
| 1 | DART는 국내 기업만 커버 | **맞음.** DART는 국내 공시 시스템이므로 해외 기업 없음. |
| 2 | DART는 주가를 제공하지 않음 | **맞음.** DS003(재무정보)·DS002(주요정보) 어디에도 시세 없음. PER/PBR은 직접 계산해야 함. |
| 3 | 발행주식수는 `stockTotqySttus`에서 | **맞음.** 다만 주의점 있음 → 2.2절 |
| 4 | SEC EDGAR는 User-Agent 헤더 필수 | **맞음, 실측 확인.** UA 없이 호출 시 `HTTP 403`, UA 넣으면 `200`. |
| 5 | DART 데이터는 2015년 이후 | **맞음.** 공식 문서에 "2015년 이후부터 정보제공" 명시. |
| 6 | exchangerate.host 사용 가능 | **틀림.** 현재 API 키 필수(apilayer 유료화). `{"code":101,"type":"missing_access_key"}` 응답 확인. → Frankfurter로 대체. |

### 추가로 발견한, 설계를 바꿔야 하는 사실 3가지

**(A) SEC의 `fy` / `fp` 필드는 회계연도 식별자로 쓰면 안 된다.**

실호출한 AAPL companyfacts에서:

```
start=2020-09-27  end=2021-09-25  val=365,817,000,000  fy=2023  fp=FY  form=10-K
```

FY2021 매출인데 `fy=2023`이다. 이 값이 FY2023 10-K에 **비교표시(comparative)**로 실린 것이기
때문이다. `fy`/`fp`는 "이 숫자가 어느 보고서에 실렸나"이지 "이 숫자가 어느 회계연도냐"가 아니다.
NVDA는 더 심하다 — 서로 다른 3개 연도가 전부 `fy=2019`로 찍힌다.

→ **회계연도는 반드시 `start`/`end` 날짜에서 직접 계산해야 한다.** (규칙은 `01-account-mapping.md` 3장)

**(B) SEC `frame` 필드는 있으면 좋지만 결측이 많다.**

NVDA 연간 6개 기간 중 `frame`이 붙은 건 2개뿐. `frame`을 정렬 키로 삼으면 데이터가 뚫린다.
다만 SEC의 정렬 규칙 자체는 참고 가치가 있어서, 우리 규칙을 이것에 맞췄다:

```
NVDA  2021-02-01 ~ 2022-01-30  →  frame=CY2021   (1월 결산 → 직전 연도로)
AAPL  2024-09-29 ~ 2025-09-27  →  frame=CY2025   (9월 결산 → 당해 연도로)
```

**(C) Stooq는 이제 서버에서 못 쓴다.** CSV 엔드포인트가 JavaScript proof-of-work 봇 차단벽
뒤로 들어갔다. 실호출 시 CSV 대신 `crypto.subtle.digest` 챌린지 HTML이 온다. 후보에서 제외.

---

## 2. 소스별 상세

### 2.1 DART OpenAPI (국내 재무제표)

| 항목 | 내용 |
|---|---|
| 엔드포인트 | `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` |
| 인증 | `crtfc_key` 쿼리 파라미터 (40자리, 무료 발급) |
| 파라미터 | `corp_code`(8), `bsns_year`(2015~), `reprt_code`, `fs_div` |
| `reprt_code` | `11013`=1Q, `11012`=반기, `11014`=3Q, `11011`=사업보고서 |
| `fs_div` | `CFS`=연결, `OFS`=별도 → **연결(CFS) 기본, 없으면 OFS 폴백** |
| 응답 | `sj_div`(BS/IS/CIS/CF/SCE), `account_id`, `account_nm`, `thstrm_amount`, `frmtrm_amount`, `bfefrmtrm_amount` |
| 커버리지 | IFRS 적용 + 정기보고서 제출 법인, **2015년 이후** |
| 비용 | 무료 |
| 상업적 이용 | 이용약관상 **명시적 금지 없음.** 저작권은 금감원 귀속, 공공데이터법 준수 의무. 재배포 제한 조항 없음 |
| 호출 한도 | ⚠️ **공식 페이지에서 수치 확인 실패.** 약관은 "이용 한도는 홈페이지에 게시"라고만 함. 단 에러코드 `020 = 요청 제한 초과`가 문서에 존재 → 한도는 확실히 있음. 통용되는 수치는 20,000건/일. **키 발급 후 실측 필요** |
| 검증 | 문서 열람 (키 미발급으로 실호출 미실시) |

주요 에러코드: `000` 정상 / `010` 미등록 키 / `013` 데이터 없음 / `020` **요청 한도 초과** /
`100` 필드 부적절 / `800` 시스템 점검 / `900` 정의되지 않은 오류.

→ `020`, `800`은 재시도 대상, `013`은 "데이터 없음(null)"으로 캐시해야 함 (재시도하면 한도만 낭비).

### 2.2 DART `stockTotqySttus` (발행주식수) — 주의점

| 응답 필드 | 의미 |
|---|---|
| `se` | 구분 (**보통주 / 우선주 / 합계**) |
| `isu_stock_totqy` | 발행할 주식의 총수 (수권주식수) |
| `istc_totqy` | 발행주식의 총수 |
| `tesstk_co` | 자기주식수 |
| `distb_stock_co` | **유통주식수 = 발행주식총수 − 자기주식** |

**PER 계산 시 함정 3개:**

1. `isu_stock_totqy`는 수권주식수(정관상 한도)다. 이걸 쓰면 PER이 말이 안 되게 나온다.
   **`distb_stock_co`(유통주식수)를 써야 한다.**
2. `se`가 보통주/우선주로 나뉜다. 삼성전자처럼 우선주가 있는 기업은 **보통주만** 집계해야
   보통주 EPS가 나온다. (삼성전자우 005935는 별도 종목)
3. 분기 시점 주식수다. 자사주 매입/소각이 있으면 기간 중 변한다 → **기말 시점 값을 그 기간에
   매칭**하고, 결측이면 직전 보고서 값 carry-forward (단 결측 표시 플래그 유지).

### 2.3 SEC EDGAR (미국 재무제표) — 실호출 검증 완료

| 항목 | 내용 |
|---|---|
| companyfacts | `https://data.sec.gov/api/xbrl/companyfacts/CIK{10자리 0패딩}.json` |
| companyconcept | `.../api/xbrl/companyconcept/CIK{...}/us-gaap/{tag}.json` |
| 기업 마스터 | `https://www.sec.gov/files/company_tickers.json` |
| 인증 | 없음. **단 `User-Agent: {회사명} {이메일}` 필수** (없으면 403 — 실측 확인) |
| 요청 한도 | 10 req/sec (SEC 공지 기준). 키 없음, 사실상 무제한 |
| 비용 | 무료 |
| 상업적 이용 | **가능.** 미국 정부 공개 자료(public domain) |
| 응답 크기 | AAPL 3.8MB / 503개 us-gaap 개념. **반드시 캐싱** |
| 검증 | 실호출 — company_tickers 796KB `200`, AAPL companyfacts 3.79MB `200`, UA 미포함 `403` |

권장 호출 전략: `companyfacts` 1회로 한 기업의 전 계정·전 기간이 다 온다.
**기업당 1회 호출 + 원본 캐시**가 정답. `companyconcept`는 부분 갱신용.

**ADR 제외 처리**: `company_tickers.json`에는 ADR도 섞여 있다.
`submissions/CIK{...}.json`의 최근 `form` 목록에 `20-F` 또는 `40-F`가 있으면 ADR/외국사기업으로
플래그하고 1차 범위에서 제외한다 (검색 결과에는 노출하되 "미지원" 배지).

### 2.4 환율 — Frankfurter (ECB) 실호출 검증 완료

```
GET https://api.frankfurter.dev/v1/2015-01-01..2015-01-10?base=USD&symbols=KRW
→ 200 {"base":"USD","rates":{"2014-12-31":{"KRW":1091.18},"2015-01-02":{"KRW":1106.24}, ...}}
```

| 항목 | 내용 |
|---|---|
| 비용 / 키 | 무료 / **불필요** |
| 데이터 | ECB 기준환율 (1999~현재), 영업일만 |
| 상업적 이용 | ECB 자료 — 출처 표기 시 사용 가능 |
| 주의 | ECB는 EUR 기준. USD/KRW는 크로스 계산값. 주말·공휴일 결측 → **직전 영업일 forward-fill** |
| 대안 | 한국은행 ECOS API (매매기준율, 키 필요) — 국내 공식 수치가 필요해지면 전환 |

---

## 3. 주가 소스 — 여기가 결정이 필요한 지점

### 3.1 무엇을 검증했나

| 소스 | 실호출 결과 | 판정 |
|---|---|---|
| Yahoo Finance `query1.../v8/finance/chart` | **`429 Too Many Requests`** | ❌ |
| Stooq CSV | **JS proof-of-work 봇 차단벽 HTML 반환** | ❌ |
| 네이버금융 `api.finance.naver.com/siseJson.naver` | **`200`, 일별 OHLCV 정상 수신** | ⚠️ 동작하나 비공식 |
| Frankfurter (환율) | `200` 정상 | ✅ |

네이버금융 실응답:
```
[['날짜','시가','고가','저가','종가','거래량','외국인소진율'],
["20240102",78200,79800,78200,79600,17142847,54.05], ...]
```

Yahoo는 IP 문제일 수도 있으나, **ToS상 자동 수집 금지**이고 crumb/cookie 인증이 수시로 바뀐다.
공개 서비스의 기반으로 삼기엔 부적절 → 제외 권장.

### 3.2 유료/무료 API 무료 티어 비교

| 서비스 | 무료 한도 | 히스토리 | 한국 종목 | **상업적 이용** | 1회 호출 범위 |
|---|---|---|---|---|---|
| **Alpha Vantage** | **25 req/일** | 20년+ | ❌ | 유료 필요 | 전체 |
| **FMP** | 250 req/일 | 5년 (무료) | ❌ (Ultimate만) | **금지** — "personal, non-business" 명시 | 전체 |
| **Twelve Data** Basic | 800 credit/일, 8/분 | 미명시 | ❌ (Basic은 3개 거래소, US만) | **금지** — "Internal non-display usage" | 전체 |
| **Tiingo** Starter | 1,000 req/일, 50/시간, 500 심볼/월 | **30년+** | ❌ (미국·중국 중심) | **금지** — "Internal Use Only" | 전체 |
| **KRX Open API** | 미공개 (키 신청 필요) | — | ✅ **공식** | 공공데이터 | **1일치 = 전 종목** |
| 네이버금융 | 없음(비공식) | 전체 | ✅ | ⚠️ 근거 없음 | 기간 지정 가능 |

**Alpha Vantage는 25 req/일이라 사실상 사용 불가**다. 프롬프트의 후보 중 이건 탈락.

### 3.3 핵심 발견 — 우리는 호출량이 문제가 아니다

이 서비스는 **월말/분기말 종가**만 있으면 된다. 일별 데이터가 필요 없다.

- 미국: Tiingo/FMP/Twelve Data 모두 **1회 호출로 전체 히스토리**를 준다 → 기업당 1회.
  최대 5개 기업 비교니까 무료 티어 250~1,000 req/일로 차고 넘친다.
- 한국: KRX Open API는 **`basDd`(1일치) 호출 1회에 그날 전 종목**이 온다.
  2015~2026 분기말 44개 날짜 × 2개 시장 = **88회 호출로 전 종목 11년치 백필 완료**.
  월별로 해도 264회. 매우 효율적이다.

그래서 **기술적 제약은 사실상 없다. 남은 건 라이선스뿐이다.**

### 3.4 라이선스 — 미국 주가를 쓰지 않기로 한 이유 (2026-08-06 확정)

미국 주가 무료 티어는 **예외 없이 재배포·표시를 금지**한다. Tiingo 약관 원문:

> "Internal use means you may only use the data for your own personal use and
> you may **not display or share the data with another person or organization**"

Finnhub·Polygon(Massive)·EODHD·Twelve Data·FMP 전부 같은 구조다.
즉 **가족에게 링크를 보내는 것만으로도 위반**이다. 유료 개인 플랜($30/월)도
"internal use" 라 재배포는 또 별도 가격이다 — 돈을 내도 문제가 해결되지 않는다.

**SEC 데이터로 대체할 수 있나 → 안 된다.**
`dei:EntityPublicFloat` 가 public domain 으로 제공되지만:

| | |
|---|---|
| 측정 시점 | **2분기 말** (AAPL 은 3월 말). 회계연도 기말(9월 말)과 6개월 어긋난다 |
| 범위 | non-affiliate 보유분만. 총 시가총액이 아니다 |
| 주기 | 연 1회 |

AAPL FY2024 로 계산하면 float 기준 28.0배, 실제 PER 은 38배다. **26% 오차**.
30년 경력 투자자에게 내놓을 수 있는 정밀도가 아니다.

**결정: 미국은 주가 연동을 하지 않는다.**

| 항목 | 국내 | 미국 |
|---|---|---|
| 매출·영업이익·순이익·자산·부채 | ✅ DART | ✅ SEC (public domain) |
| 영업이익률·순이익률·ROE·부채비율 | ✅ | ✅ |
| **PER·PBR·EPS·시가총액** | ✅ **KRX 공식** | ❌ 미제공 |

할아버지가 원래 요청하신 "영업이익 비교 그래프"는 전부 커버된다.
국내 종목은 밸류에이션까지 다 나온다. 비용 0원, 라이선스 리스크 없음.

`TIINGO_API_KEY` 를 채우면 미국 밸류에이션이 즉시 동작하도록 어댑터는 남겨 뒀다.
다만 그 상태로 **배포하면 약관 위반**이므로 기본값은 비워 둔다.

대안으로 검토했다가 접은 것:
- **BYOK** — 사용자가 자기 무료 키를 브라우저에 넣고 Tiingo 를 직접 호출.
  각자 "internal use" 라 성립하지만, 고령 사용자에게 계정 생성을 요구하게 된다
- **유료 재배포 라이선스** — 월 $50 이상. 개인 프로젝트에 과하다

### 3.5 국내 주가 권장안

**채택: KRX Open API** — `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd`
(헤더 `AUTH_KEY`, 파라미터 `basDd`=YYYYMMDD). 공식·무료.

실제로 붙여보고 확인한 것 (2026-08-06):

| 항목 | 결과 |
|---|---|
| 제공 범위 | 2015년까지 확인 (2015-12-30 KOSPI 887종목) |
| 응답 | `basDd` 하루치에 **전 종목**. KOSPI 961개 / 298KB |
| 종가 | **미조정 실거래가**. 2017-12-28 삼성전자 = 2,548,000원 |
| 추가 필드 | `MKTCAP`(시가총액), `LIST_SHRS`(상장주식수)도 함께 온다 |

**미조정가라는 게 결정적이다.** 네이버는 수정주가를 주는데, 그걸 각 시점 공시 EPS 와
나누면 삼성전자 2017년 PER 이 0.17배로 나온다(실제 약 8.5배). KRX 를 쓰면
액면분할 조정 자체가 불필요하다.

⚠️ **인증키 승인 ≠ API 이용신청**. 키만 승인받은 상태에서는 모든 엔드포인트가 401 이다.
「서비스 이용 > 주식」에서 서비스별로 이용신청을 해야 하고, 마이페이지 이용현황에서
상태가 "승인"으로 바뀌어야 한다. 이 구분을 몰라 한참 헤맸다.

⚠️ **연말 마지막 거래일이 해마다 다르다.** 2016년은 12/29, 2015·2024년은 12/30 이다.
회계연도 기말(12/31)은 늘 휴장이므로 직전 거래일로 거슬러 올라가는 폴백이 필수다.

**2순위(폴백): 네이버금융 siseJson** — 실동작 확인했고 기간 지정이 되어 편하지만
비공식 엔드포인트라 예고 없이 막힐 수 있고 이용 근거가 없다. 개발 중 임시용으로만.

⚠️ KRX Open API의 정확한 응답 필드와 호출 한도는 **키 발급 후 실측**해야 한다.
공개 문서 페이지가 JS 렌더링이라 크롤링으로 확인되지 않았다.

---

## 4. 남은 미확인 항목 (Phase 1 착수 시 실측)

1. DART 일일 호출 한도 실제 수치 — 키 발급 후 `020` 도달 지점 확인
2. KRX Open API 응답 스키마·호출 한도 — 키 승인 후 확인
3. Tiingo 무료 티어의 "500 unique symbols/month" 카운팅 방식 (심볼당 1회인지 누적인지)

---

## 참고 링크

- [OPENDART 개발가이드](https://opendart.fss.or.kr/guide/main.do?apiGrpCd=DS003)
- [OPENDART 이용약관](https://opendart.fss.or.kr/intro/terms.do)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [KRX Data Marketplace OPEN API](https://openapi.krx.co.kr/)
- [Frankfurter](https://frankfurter.dev/)
- [Tiingo Pricing](https://www.tiingo.com/about/pricing)
- [Twelve Data Pricing](https://twelvedata.com/pricing)
- [FMP Terms of Service](https://site.financialmodelingprep.com/terms-of-service)
- [Alpha Vantage Premium](https://www.alphavantage.co/premium/)
