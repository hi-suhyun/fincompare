import { MAX_COMPANIES, styleForIndex } from '@fincompare/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { searchCompanies, type CompanySearchResult } from '../../lib/api.js';

interface Props {
  selected: readonly string[];
  names: ReadonlyMap<string, string>;
  onAdd: (company: CompanySearchResult) => void;
  onRemove: (companyId: string) => void;
}

const MARKET_LABEL: Record<string, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
};

export function CompanyPicker({ selected, names, onAdd, onRemove }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // 타이핑마다 요청하면 초성 검색처럼 짧은 입력에서 요청이 쏟아진다
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ['companySearch', debounced],
    queryFn: () => searchCompanies(debounced),
    enabled: debounced.length > 0,
  });

  const results = (data?.results ?? []).filter((r) => !selected.includes(r.id));
  const isFull = selected.length >= MAX_COMPANIES;

  useEffect(() => setActiveIndex(0), [debounced]);

  // 바깥을 누르면 목록을 닫는다
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (company: CompanySearchResult): void => {
    if (isFull || !company.isSupported) return;
    onAdd(company);
    setQuery('');
    setDebounced('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = results[activeIndex];
      if (picked !== undefined) choose(picked);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef} className="relative">
        <label htmlFor={`${listId}-input`} className="mb-1.5 block font-semibold">
          기업 검색
        </label>
        <input
          id={`${listId}-input`}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={isFull}
          placeholder={isFull ? `최대 ${MAX_COMPANIES}개까지 비교할 수 있습니다` : '삼성전자, 005930, ㅅㅅㅈㅈ, samsung'}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full rounded-lg border-2 border-[var(--line)] bg-white px-4 py-3 text-lg
                     placeholder:text-[var(--ink-muted)] disabled:bg-[var(--surface-sunken)]
                     disabled:text-[var(--ink-muted)]"
        />

        {open && debounced.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border-2
                       border-[var(--line)] bg-white shadow-lg"
          >
            {isFetching && results.length === 0 && (
              <li className="px-4 py-3 text-[var(--ink-muted)]">찾는 중…</li>
            )}
            {!isFetching && results.length === 0 && (
              <li className="px-4 py-3 text-[var(--ink-muted)]">
                검색 결과가 없습니다. 종목코드나 영문명으로도 찾을 수 있습니다.
              </li>
            )}
            {results.map((company, index) => (
              <li key={company.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onClick={() => choose(company)}
                  onMouseEnter={() => setActiveIndex(index)}
                  disabled={!company.isSupported}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left
                              disabled:cursor-not-allowed disabled:opacity-50
                              ${index === activeIndex ? 'bg-[#eaf4fb]' : 'bg-white'}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{company.nameKo}</span>
                  <span className="tabular shrink-0 text-[var(--ink-muted)]">{company.ticker}</span>
                  <span className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-sm text-[var(--ink-muted)]">
                    {MARKET_LABEL[company.market] ?? company.market}
                  </span>
                  {company.fiscalYearEndBadge !== null && (
                    <span className="shrink-0 rounded bg-[#fff4e0] px-1.5 py-0.5 text-sm text-[#8a5a00]">
                      {company.fiscalYearEndBadge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((id, index) => {
            const style = styleForIndex(index);
            return (
              <li key={id}>
                <span
                  className="inline-flex items-center gap-2 rounded-full border-2 bg-white py-1.5 pl-3 pr-1.5"
                  style={{ borderColor: style.color }}
                >
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
                    style={{ background: style.color }}
                  />
                  <span className="font-medium">{names.get(id) ?? id}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(id)}
                    aria-label={`${names.get(id) ?? id} 제거`}
                    className="compact flex h-8 w-8 items-center justify-center rounded-full
                               text-xl leading-none text-[var(--ink-muted)] hover:bg-[var(--surface-sunken)]"
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
