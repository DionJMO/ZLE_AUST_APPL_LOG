---
name: project2
description: HiLIS Monitoring ZLE_AUST – SAP S/4HANA + Fiori OVP Projekt bei Kroschke SIGN International GmbH. Aktivieren für ABAP-Entwicklung, Fiori OVP, CDS Views, REST-Consumer-Klassen und HiLIS-API-Integration.
---

# HiLIS Monitoring / ZLE_AUST

Dieses Skill gibt dir sofortigen Kontext für das HiLIS-ERP-Integrationsprojekt.

## When to use

Aktiviere diesen Skill wenn du:
- ABAP-Klassen (`ZCL_ZLE_AUST_*`) entwickelst oder erweiterst
- CDS Views oder OData-Services für die Monitoring-App anpasst
- An der Fiori OVP App (`webapp/`) arbeitest
- Die HiLIS REST-API (`/api/inbound-orders`, `/api/items`, etc.) integrierst
- Unit-Tests für Consumer-Klassen schreibst
- Fragen zum Projektstand, Architektur oder offenen Punkten hast

## Instructions

1. **Lies zuerst CLAUDE.md** – das ist die Single Source of Truth für dieses Projekt (Coding-Vorgaben, Architektur, API-Strukturen, offene Punkte, Meilensteine)
2. **Lies HANDOVER.md** – aktueller Session-Stand, was zuletzt gemacht wurde, empfohlene nächste Schritte
3. **Beachte die Namenskonventionen:**
   - Klassen: `ZCL_ZLE_AUST_*`, alle anderen ABAP-Objekte: `ZLE_AUST*`
   - Lokale Variablen: `lv_*` / `lr_*` / `lt_*` / `ls_*`
   - Klassenattribute: `mv_*` / `mr_*` / `mt_*` / `ms_*`
   - Methodennamen: Englisch, max. 30 Zeichen
4. **Verfügbare MCP-Tools nutzen:**
   - `mcp__sap-cc__sapObjSource` – ABAP-Quellcode direkt aus C01 lesen
   - `mcp__sap-cc__sapObjName` – Objektliste aus C01 abfragen
   - `mcp__sap-cc__sapTransporte` – Transporte des aktuellen Users
   - `mcp__claude_ai_Atlassian__getConfluencePage` – Confluence SPE-Seiten lesen (Feldmappings, Protokolle)
5. **Bestehende Basisklasse verwenden:** Neue Consumer-Klassen erben von `ZCL_ZLE_AUST_BASE` und rufen `ensure_connected()` vor HTTP-Calls auf
6. **JSON:** Immer `/ui2/cl_json` verwenden (nicht `/ui3/cl_json`)
7. **Logging:** `write_log()` aus Basisklasse – GET=nur Fehler loggen, POST/PUT/DELETE=Erfolg+Fehler loggen
8. **Git:** Auf Branch `develop` arbeiten und committen; `main` für stabile Stände

## Projektkontext

- **System:** S/4HANA 758, Mandant Kroschke SIGN, HiLIS API v10.2.0
- **Backend:** `https://c01ap.kroschke.com:52201`
- **OData-Service URI:** `/sap/opu/odata4/sap/zle_aust_sb_appl_log/srvd/sap/zle_aust_sd_appl_log/0001/`
- **M5-Deadline:** 20.06.2026 – Fiori App v1 (KPI, TPA-Tabelle, Log-Kachel)
- **Nächste offene Aufgabe:** TPA-Puffertabelle `ZLE_AUST_TPA` + CDS + Service für TPA- und KPI-Kachel
