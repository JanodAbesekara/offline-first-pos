create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  category text,
  created_at timestamptz default now()
);

create table if not exists variants (
  id uuid primary key,
  product_id uuid references products(id),
  sku text unique not null,
  barcode text unique,
  size text,
  color text,
  price_cents int not null,
  stock_qty int not null default 0,
  needs_reconciliation bool default false,
  updated_at timestamptz default now()
);
-- Intentionally NO CHECK (stock_qty >= 0): offline oversells must never reject paid customer receipts

create table if not exists sales (
  id uuid primary key,
  receipt_no text unique not null,
  terminal_id text default 'T1',
  created_at timestamptz,
  synced_at timestamptz default now(),
  subtotal_cents int,
  discount_cents int,
  tax_cents int,
  total_cents int,
  method text check (method in ('CASH', 'CARD')),
  tendered_cents int,
  change_cents int,
  status text check (status in ('COMPLETED', 'VOIDED', 'PARTIAL_RETURN', 'RETURNED'))
);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id),
  variant_id uuid,
  qty int,
  unit_price_cents int
);

create table if not exists returns (
  id uuid primary key,
  sale_id uuid references sales(id),
  reason text,
  restock bool default true,
  refund_cents int,
  created_at timestamptz
);

create table if not exists return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid references returns(id),
  variant_id uuid,
  qty int
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid,
  delta int,
  type text check (type in ('SALE', 'RETURN', 'RECEIVE', 'ADJUST')),
  ref_id uuid,
  created_at timestamptz default now()
);

create table if not exists stock_alerts (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references variants(id),
  stock_qty int not null,
  resolved bool default false,
  created_at timestamptz default now()
);

create table if not exists processed_events (
  event_id uuid primary key,
  received_at timestamptz default now()
);

create or replace function apply_event(p jsonb) returns text
language plpgsql
security definer
as $$
declare
  e uuid := (p->>'event_id')::uuid;
  pl jsonb := p->'payload';
  i jsonb;
  v_new_qty int;
  v_sold_qty int;
  v_ret_qty int;
begin
  insert into processed_events(event_id) values (e) on conflict do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p->>'type' = 'SALE' then
    insert into sales (
      id, receipt_no, terminal_id, created_at,
      subtotal_cents, discount_cents, tax_cents, total_cents,
      method, tendered_cents, change_cents, status
    )
    values (
      e,
      pl->>'receipt_no',
      coalesce(pl->>'terminal_id', 'T1'),
      (pl->>'created_at')::timestamptz,
      (pl->>'subtotal')::int,
      (pl->>'discount')::int,
      (pl->>'tax')::int,
      (pl->>'total')::int,
      pl->>'method',
      (pl->>'tendered')::int,
      (pl->>'change')::int,
      'COMPLETED'
    );

    for i in select * from jsonb_array_elements(pl->'items') loop
      insert into sale_items (sale_id, variant_id, qty, unit_price_cents)
      values (e, (i->>'variant_id')::uuid, (i->>'qty')::int, (i->>'price')::int);

      insert into stock_movements (variant_id, delta, type, ref_id)
      values ((i->>'variant_id')::uuid, -(i->>'qty')::int, 'SALE', e);

      update variants
      set stock_qty = stock_qty - (i->>'qty')::int,
          needs_reconciliation = (stock_qty - (i->>'qty')::int) < 0,
          updated_at = now()
      where id = (i->>'variant_id')::uuid
      returning stock_qty into v_new_qty;

      if v_new_qty is not null and v_new_qty < 0 then
        insert into stock_alerts (variant_id, stock_qty)
        values ((i->>'variant_id')::uuid, v_new_qty);
      end if;
    end loop;

  elsif p->>'type' = 'RETURN' then
    insert into returns (id, sale_id, reason, restock, refund_cents, created_at)
    values (
      e,
      (pl->>'sale_id')::uuid,
      coalesce(pl->>'reason', 'Customer Return'),
      coalesce((pl->>'restock')::bool, true),
      (pl->>'refund')::int,
      (pl->>'created_at')::timestamptz
    );

    for i in select * from jsonb_array_elements(pl->'items') loop
      insert into return_items (return_id, variant_id, qty)
      values (e, (i->>'variant_id')::uuid, (i->>'qty')::int);

      if coalesce((pl->>'restock')::bool, true) then
        insert into stock_movements (variant_id, delta, type, ref_id)
        values ((i->>'variant_id')::uuid, (i->>'qty')::int, 'RETURN', e);

        update variants
        set stock_qty = stock_qty + (i->>'qty')::int,
            needs_reconciliation = (stock_qty + (i->>'qty')::int) < 0,
            updated_at = now()
        where id = (i->>'variant_id')::uuid;
      end if;
    end loop;

    select coalesce(sum(qty), 0) into v_sold_qty
    from sale_items where sale_id = (pl->>'sale_id')::uuid;

    select coalesce(sum(ri.qty), 0) into v_ret_qty
    from return_items ri
    join returns r on r.id = ri.return_id
    where r.sale_id = (pl->>'sale_id')::uuid;

    update sales
    set status = case when v_ret_qty >= v_sold_qty then 'RETURNED' else 'PARTIAL_RETURN' end
    where id = (pl->>'sale_id')::uuid;
  end if;

  return 'ok';
end $$;

grant execute on function apply_event(jsonb) to anon;
