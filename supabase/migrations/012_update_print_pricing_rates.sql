-- Update the sliced-print component of each estimate to:
-- ($2.50 x total print hours) + ($0.40 x total filament grams).
-- Design and assembly remain separate optional charges. Quantity and the
-- colour-purge allowance are already included in the totals used by the
-- calculation.

update public.print_estimator_config
set base_price = 0.00,
    hourly_production_factor = 2.50,
    material_rate_per_gram = 0.40,
    updated_at = now()
where singleton = true;
