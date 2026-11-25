-- The billing screen remains available, but member/profile administration is paused with the business workspace.
do $function$
declare
  function_oid regprocedure;
  definition text;
  updated_definition text;
begin
  function_oid := 'public.get_organization_members(uuid)'::regprocedure;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.regexp_replace(
    definition,
    '(?s)(IF v_user_id IS NULL THEN.*?END IF;)',
    E'\\1\n\n  IF NOT private.organization_has_access(p_organization_id,NULL) THEN\n    RAISE EXCEPTION ''An active subscription is required to view the team.'' USING ERRCODE=''42501'';\n  END IF;',
    '1'
  );
  if updated_definition=definition then raise exception 'Could not protect get_organization_members'; end if;
  execute updated_definition;

  function_oid := 'public.manage_organization_member_role(uuid,uuid,text)'::regprocedure;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.regexp_replace(
    definition,
    '(?s)(IF v_user_id IS NULL THEN.*?END IF;)',
    E'\\1\n\n    IF NOT private.organization_has_access(p_organization_id,NULL) THEN\n      RAISE EXCEPTION ''An active subscription is required to manage team roles.'' USING ERRCODE=''42501'';\n    END IF;',
    '1'
  );
  if updated_definition=definition then raise exception 'Could not protect manage_organization_member_role'; end if;
  execute updated_definition;

  function_oid := 'public.remove_organization_member(uuid,uuid)'::regprocedure;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.regexp_replace(
    definition,
    '(?s)(IF v_user_id IS NULL THEN.*?END IF;)',
    E'\\1\n\n    IF NOT private.organization_has_access(p_organization_id,NULL) THEN\n      RAISE EXCEPTION ''An active subscription is required to remove team members.'' USING ERRCODE=''42501'';\n    END IF;',
    '1'
  );
  if updated_definition=definition then raise exception 'Could not protect remove_organization_member'; end if;
  execute updated_definition;

  function_oid := 'public.update_organization_profile(uuid,text,text,text,text,text,text,text)'::regprocedure;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.regexp_replace(
    definition,
    '(?s)(IF v_user_id IS NULL THEN.*?END IF;)',
    E'\\1\n\n  IF NOT private.organization_has_access(p_organization_id,NULL) THEN\n    RAISE EXCEPTION ''An active subscription is required to update the business profile.'' USING ERRCODE=''42501'';\n  END IF;',
    '1'
  );
  if updated_definition=definition then raise exception 'Could not protect update_organization_profile'; end if;
  execute updated_definition;

  function_oid := 'public.create_organization_invitation(uuid,text,text,uuid)'::regprocedure;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  updated_definition := pg_catalog.regexp_replace(
    definition,
    '(?s)(if p_organization_id is null then.*?end if;)',
    E'\\1\n  if not private.organization_subscription_is_active(p_organization_id) then\n    raise exception ''An active subscription is required before inviting team members'' using errcode=''42501'';\n  end if;',
    '1'
  );
  if updated_definition=definition then raise exception 'Could not protect create_organization_invitation'; end if;
  execute updated_definition;
end;
$function$;
