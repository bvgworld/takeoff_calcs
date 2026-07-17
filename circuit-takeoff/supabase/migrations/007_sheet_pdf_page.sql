-- Which PDF page was rasterized (for sharp-zoom overlay).

alter table sheets
  add column if not exists pdf_page integer not null default 1;

alter table sheets drop constraint if exists sheets_pdf_page_check;
alter table sheets add constraint sheets_pdf_page_check
  check (pdf_page >= 1);
