-- Lower the manufacturing machine-time rate from $5/hour to $3/hour.
-- All other pricing components and risk tiers remain unchanged.

update public.print_estimator_config
set hourly_production_factor = 3,
    updated_at = now()
where singleton = true;

notify pgrst, 'reload schema';
