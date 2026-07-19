-- Which PDF page was rasterized (for sharp-zoom overlay).

alter table sheets
  add column if not exists pdf_page integer not null default 1;

alter table sheets drop constraint if exists sheets_pdf_page_check;
alter table sheets add constraint sheets_pdf_page_check
  check (pdf_page >= 1);

-- Migration marker (table created in 011; guarded so fresh databases
-- running 001..011 in order do not fail before 011 exists).
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);
insert into schema_migrations (filename) values ('007_sheet_pdf_page.sql')
  on conflict do nothing;
