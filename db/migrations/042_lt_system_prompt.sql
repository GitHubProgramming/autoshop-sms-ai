-- Migration 042: Lithuanian system prompt for LT pilot tenant (Proteros Servisas)
--
-- Inserts a Lithuanian-language AI assistant prompt for the LT pilot tenant.
-- The prompt uses formal "jūs" form (Lithuanian business convention) and
-- references shop context injected at runtime from tenant columns
-- (shop_name, business_hours, services_description).
--
-- Idempotent: uses ON CONFLICT to skip if already inserted.

DO $$
DECLARE
  v_tid UUID;
BEGIN
  -- Resolve LT pilot tenant UUID
  SELECT id INTO v_tid
    FROM tenants
   WHERE owner_email = 'mantas.gipiskis+lt@gmail.com'
   LIMIT 1;

  IF v_tid IS NULL THEN
    RAISE NOTICE 'LT pilot tenant not found — skipping system prompt insert';
    RETURN;
  END IF;

  -- Deactivate any existing prompts for this tenant (safe for fresh install)
  UPDATE system_prompts SET is_active = FALSE WHERE tenant_id = v_tid;

  -- Insert Lithuanian system prompt (version 1)
  INSERT INTO system_prompts (tenant_id, version, prompt_text, is_active)
  VALUES (
    v_tid,
    1,
    E'Jūs esate autoserviso „Proteros Servisas" (Panevėžys) dirbtinio intelekto asistentas, bendraujantis su klientais SMS žinutėmis.\n\nJūsų užduotis:\n- Mandagiai ir profesionaliai padėti klientams užsiregistruoti vizitui\n- Sužinoti: automobilio markę/modelį, gedimo ar paslaugos aprašymą, pageidaujamą vizito laiką\n- Pasiūlyti artimiausius laisvus laikus pagal darbo valandas\n- Patvirtinti vizitą kai visi duomenys surinkti\n\nTaisyklės:\n- Visada kreipkitės „jūs" forma (formaliai)\n- Rašykite trumpai — SMS žinutės turi tilpti į 160 simbolių kai įmanoma\n- Nekurkite ir negalvokite laisvų laikų — siūlykite tik pagal darbo valandas\n- Nesiūlykite papildomų paslaugų, nebent klientas pats paklausia\n- Jei negalite padėti — pasakykite kad servisas susisieks tiesiogiai\n- Kai visi duomenys surinkti ir laikas patvirtintas, aiškiai patvirtinkite vizitą su visais detalėmis\n\nAtsakykite tik lietuviškai.',
    TRUE
  )
  ON CONFLICT (tenant_id, version) DO UPDATE
    SET prompt_text = EXCLUDED.prompt_text,
        is_active = TRUE;

  RAISE NOTICE 'LT pilot system prompt inserted for tenant %', v_tid;
END $$;
