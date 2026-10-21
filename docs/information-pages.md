# Information pages: operator follow-up

Implemented October 20, 2026. These pages describe the current code; they do not establish legal compliance or WCAG conformance.

## Before relying on the notices

- Publish the actual operator/controller identity and a working private contact method. The repository is the only verified contact route; public issues are unsuitable for personal requests and GitHub may require an account.
- Confirm intended audience, jurisdictions, minimum age, and whether GDPR, CCPA/CPRA, CalOPPA, or other requirements apply. Obtain legal review of notices and terms, including lawful bases, international transfers, required disclosures, request methods and deadlines, and any needed change/acceptance process. No jurisdiction, company identity, liability waiver, arbitration clause, or response deadline has been invented.
- Confirm operational facts outside source code: provider regions, log and backup retention, deletion workflow, service operator access, deployed tracking, and any additional processors. Name the actual Sites hosting/sign-in provider if that deployment remains offered.
- Establish a verified account deletion/privacy request process, a way to notify users of material changes when required, and any required consent or opt-out mechanisms. Stating rights on a page does not implement them.
- Evaluate real sign-in, keyboard, screen-reader, high-zoom, reduced-motion, contrast, dialogs, and mobile flows against WCAG 2.2 AA. The statement deliberately makes no conformance claim.

## Integration

The named LegalLinks component from src/components/LegalLinks.tsx is integrated into sign-in, the sidebar, Help, and account Settings. It uses existing text-button classes. The information pages already link to each other and back to the app. They require no JavaScript or authentication. Vite copies public assets to dist; the Sites worker builder also collects these static assets.

## Official references reviewed

- FTC privacy/security: https://www.ftc.gov/business-guidance/privacy-security — privacy claims must match actual practices.
- W3C accessibility statement guidance: https://www.w3.org/WAI/planning/statements/ — disclose status, limitations, contact, and evaluation scope; a statement is not a conformance evaluation.
- California Attorney General CCPA guidance: https://www.oag.ca.gov/privacy/ccpa — applicability and rights depend on the business and law; the notice does not assert that every listed right applies everywhere.
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Verification

Production build passed. Static checks passed for build output assets, local links, language, page titles, heading structure, active navigation, skip targets, no script requirement, and text color contrast. Local HTTP requests were denied (EACCES) and the in-app browser could not reach the dev server (connection timeout), so visual browser checks and assistive-technology evaluation are still outstanding.
