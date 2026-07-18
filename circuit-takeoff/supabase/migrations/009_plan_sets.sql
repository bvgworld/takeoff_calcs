-- Plan sets: multi-page upload, disciplines, levels, ordering.

alter table sheets add column discipline text not null default 'power'
  check (discipline in ('lighting','power','fire','data','demo','site','other'));
alter table sheets add column level text not null default '';   -- 'Level 1', 'Basement'
alter table sheets add column page_number int;                   -- page in source PDF
alter table sheets add column source_pdf_path text;              -- shared set PDF
alter table sheets add column sort_order int not null default 0;

-- Backfill legacy single-page uploads.
update sheets set page_number = coalesce(pdf_page, 1) where page_number is null;
update sheets set source_pdf_path = pdf_path where source_pdf_path is null;

-- Stable initial ordering by upload time within each project.
with ordered as (
  select id, row_number() over (
    partition by project_id order by created_at asc
  ) as rn
  from sheets
)
update sheets s set sort_order = o.rn
from ordered o
where s.id = o.id and s.sort_order = 0;
