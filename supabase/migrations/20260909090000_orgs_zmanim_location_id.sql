-- A generic org-level zmanim location id, alongside the existing
-- myzmanim_location_id -- not a replacement for it.
--
-- orgs.myzmanim_location_id is MyZmanim-specific (cached from its own
-- searchPostal at onboarding, plan.md §5c). screens.zmanim_location_id is
-- already generic -- any provider -- but orgs never got the same generic
-- column, so an org whose own default provider is Chabad has nowhere to
-- persist its Chabad location id; only a screen can. This closes that gap
-- without touching the MyZmanim-specific column at all.
--
-- When MyZmanim actually gets built, it will have to decide whether it reads
-- this generic column too or keeps its own -- deliberately not decided here,
-- so it doesn't get decided by default just because this column existed
-- first.
alter table public.orgs
  add column zmanim_location_id text;
