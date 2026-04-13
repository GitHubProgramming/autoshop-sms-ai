-- Migration 043: Populate business context for LT pilot tenant (Proteros Servisas)
--
-- Sets business_hours and services_description on the LT pilot tenant row.
-- These columns are injected into the AI system prompt at runtime by process-sms.ts.
--
-- Idempotent: UPDATE with WHERE clause, safe to re-run.

UPDATE tenants
   SET business_hours = E'Pirmadienis\u2013Penktadienis: 08:00\u201318:00\nŠeštadienis: 09:00\u201314:00\nSekmadienis: nedirba',
       services_description = 'Bendrieji remonto darbai, variklio diagnostika, stabdžių sistema, pakaba ir vairo mechanizmas, ratų geometrija, padangų keitimas ir saugojimas, alyvos ir filtrų keitimas, kondicionieriaus pildymas ir remontas, akumuliatoriaus patikra ir keitimas, prieš-techninės apžiūros patikrinimas.',
       missed_call_sms_template = 'Sveiki! Pastebėjome, kad skambinote į Proteros Servisas, bet negalėjome atsiliepti. Kuo galime padėti? Atsakykite čia ir mes jums padėsime.',
       updated_at = NOW()
 WHERE owner_email = 'mantas.gipiskis+lt@gmail.com';
