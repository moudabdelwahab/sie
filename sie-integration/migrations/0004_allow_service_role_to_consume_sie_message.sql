-- 0004_allow_service_role_to_consume_sie_message.sql
-- ============================================================================
-- STATUS: APPLIED to the shared Mad3oom/SIE project (srnelrdpqkcntbgudyto).
--
-- sie_consume_message() refused whenever p_user_id <> auth.uid(). That is
-- exactly right for the browser, where the customer's own session is the
-- authority — and it makes the function unusable from a channel webhook,
-- where there is no session at all and auth.uid() is null.
--
-- WHY NOT A SECOND FUNCTION
--
-- The obvious alternative was a channel-specific consume function. That would
-- mean two implementations of "is this customer allowed one more message",
-- free to drift apart, plus a real risk of charging twice if a channel ever
-- called both. Teaching the one function about the one other legitimate
-- caller keeps a single metering path for every channel.
--
-- WHY IT IS SAFE
--
-- service_role is already a fully privileged key that bypasses RLS
-- everywhere. It cannot be obtained by a customer, and anything holding it
-- could already write customer_sie_access directly — so this grants no new
-- capability. The webhook is what constrains it: it only ever passes a
-- user_id resolved from an ACTIVE channel_identities row, so an unlinked chat
-- still cannot bill anyone.
--
-- Verified after applying: an `authenticated` caller with no session is still
-- refused with 'unauthorized'. Everything else — the three rules, their
-- order, the return shape — is unchanged, so the browser path behaves exactly
-- as before.
-- ============================================================================

create or replace function public.sie_consume_message(p_user_id uuid)
returns table(allowed boolean, reason text, remaining integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_row public.customer_sie_access%rowtype;
begin
    if p_user_id is null then
        return query select false, 'unauthorized'::text, null::integer;
        return;
    end if;

    -- Either the caller IS this user, or the caller is the service role
    -- acting for them from a channel webhook.
    if p_user_id <> coalesce(auth.uid(), p_user_id) or
       (auth.uid() is null and coalesce(auth.role(), '') <> 'service_role') then
        return query select false, 'unauthorized'::text, null::integer;
        return;
    end if;

    select * into v_row
    from public.customer_sie_access
    where user_id = p_user_id
    for update;

    if not found then
        return query select false, 'not_enabled'::text, null::integer;
        return;
    end if;

    if not v_row.is_enabled then
        return query select false, 'disabled'::text, null::integer;
        return;
    end if;

    if v_row.access_mode = 'expiration' and v_row.expires_at is not null and v_row.expires_at < now() then
        return query select false, 'expired'::text, null::integer;
        return;
    end if;

    if v_row.access_mode = 'quota' and v_row.messages_used >= coalesce(v_row.message_quota, 0) then
        return query select false, 'quota_exceeded'::text, 0;
        return;
    end if;

    update public.customer_sie_access
    set messages_used = messages_used + 1,
        last_used_at = now()
    where user_id = p_user_id
    returning messages_used into v_row.messages_used;

    if v_row.access_mode = 'quota' then
        return query select true, null::text, greatest(v_row.message_quota - v_row.messages_used, 0);
    else
        return query select true, null::text, null::integer;
    end if;
end;
$function$;
