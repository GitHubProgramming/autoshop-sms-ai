-- Migration 046 (LT pilot): expanded services_description for Proteros Servisas
--
-- Apr 2026 user feedback: AI refused to book a tire-change appointment
-- citing "tik remonto paslaugas" (only repair services). The previous
-- services_description (set in 043_lt_tenant_context.sql) listed core
-- services but did not explicitly include common pilot-shop work like
-- tire mounting/balancing, transmission, clutch, exhaust, or pre-TÜV
-- preparation. The AI prompt injects this string verbatim, so a narrow
-- list directly causes scope rejections.
--
-- This migration broadens the canonical services list. Companion
-- migration 047_lt_system_prompt_v3.sql also adjusts the prompt to
-- explicitly accept all car repair / maintenance requests.
--
-- Idempotent: targeted UPDATE keyed on the LT pilot tenant email.
-- Safe to re-run; safe for non-LT tenants (filter is exact-match).

UPDATE tenants
   SET services_description = 'Bendrieji remonto darbai, variklio diagnostika, stabdžių sistema, pakaba ir vairo mechanizmas, ratų geometrija, padangų keitimas ir montavimas, ratų keitimas ir balansavimas, alyvos ir filtrų keitimas, kondicionieriaus pildymas ir remontas, akumuliatoriaus patikra ir keitimas, prieš-techninės apžiūros patikrinimas, elektros sistemos diagnostika, greičių dėžės remontas, sankabos keitimas, išmetimo sistemos remontas, automobilio paruošimas techninei apžiūrai.',
       updated_at = NOW()
 WHERE owner_email = 'mantas.gipiskis+lt@gmail.com';
