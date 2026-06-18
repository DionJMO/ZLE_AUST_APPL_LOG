# Übergabe-Dokument – HiLIS Monitoring / ZLE_AUST
**Session:** 16.06.2026 | **Entwickler:** Dion Maring Ouambo (D.MaringOuambo@kroschke.com)

---

## Was ist dieses Projekt?

SAP-seitige Fiori OVP-Monitoring-App für die HiLIS/AutoStore-Schnittstelle bei Kroschke SIGN International GmbH (Projekt 205845). ABAP-Consumer-Klassen (`ZCL_ZLE_AUST_*`) kommunizieren per REST mit der HiLIS-Middleware. Eine Fiori OVP zeigt Log, TPAs, Abbruchmaterialien und KPIs.

Die vollständige Projektdoku steht in **[CLAUDE.md](CLAUDE.md)** – das ist die Single Source of Truth. Immer zuerst lesen.

---

## Was wurde in dieser Session gemacht? (16.06.2026)

### Fiori OVP – neue Kacheln
| Was | Datei | Beschreibung |
|---|---|---|
| bundleName-Fix | [webapp/manifest.json](webapp/manifest.json) | `project1.i18n.i18n` → `zui5_zle_aust_mon.i18n.i18n` |
| Abbruchmaterialien-Kachel | [webapp/manifest.json](webapp/manifest.json) + [annotation.xml](webapp/annotations/annotation.xml) | `abbruchCard` – AppLog-Service, gefiltert auf `LogType = 'E'` via `UI.SelectionVariant#AbbruchCard` |
| Kontakte-Kachel | [webapp/manifest.json](webapp/manifest.json) | Statische Linklist-Kachel `kontakteCard` mit Hörmann PM, WMS-Support, Kroschke IT |
| TPA-Kachel | [webapp/manifest.json](webapp/manifest.json) + [tpaAnnotation.xml](webapp/annotations/tpaAnnotation.xml) | `tpaCard` – TPA-Service, `UI.LineItem#TpaCard` mit StatusCriticality |
| i18n-Texte | [webapp/i18n/i18n.properties](webapp/i18n/i18n.properties) | Kartentitel/-untertitel für alle neuen Kacheln |
| TPA Mock-Metadata | [webapp/localService/tpaService/metadata.xml](webapp/localService/tpaService/metadata.xml) | OData V4 Mockdaten für `TpaType` EntitySet |

### TPA-Puffer-Stack (ABAP DDL, noch in ADT einzupflegen)
| Datei | Objekt | Status |
|---|---|---|
| [abap_files/ZLE_AUST_TPA.abap](abap_files/ZLE_AUST_TPA.abap) | DB-Tabelle | DDL fertig, ADT-Aktivierung ausstehend |
| [abap_files/ZLE_AUST_I_TPA.abap](abap_files/ZLE_AUST_I_TPA.abap) | Interface View | DDL fertig |
| [abap_files/ZLE_AUST_C_TPA.abap](abap_files/ZLE_AUST_C_TPA.abap) | Consumption View | DDL fertig, **ohne `@UI.facets`** (Systembeschränkung) |
| [abap_files/ZLE_AUST_SD_TPA.abap](abap_files/ZLE_AUST_SD_TPA.abap) | Service Definition | DDL fertig |

### Fix: `@UI.facets` entfernt
- [abap_files/ZLE_AUST_C_TPA.abap](abap_files/ZLE_AUST_C_TPA.abap) und [abap_files/ZLE_AUST_C_APPL_LOG.abap](abap_files/ZLE_AUST_C_APPL_LOG.abap): `@UI.facets` und `@UI.fieldGroup` entfernt (auf S/4HANA 758 nicht aktivierbar). Betroffene Felder mit `@UI.hidden: true` markiert.

### CLAUDE.md + Entwicklungskonzept aktualisiert
- CLAUDE.md: Alle neu entdeckten Objekte eingetragen (per SAP-CC MCP), Architekturfehler korrigiert (`ZMMC_STD_CONCONF` → `ZLE_AUST_CONCONF`, M7 auf ✅ gesetzt, REST-Server-Schicht vollständig dokumentiert)
- Entwicklungskonzept v1.2: Komplette Überarbeitung, aktueller Systemstand

### MCP-Setup
- **SAP-CC MCP** registriert (user scope): `node /mnt/c/localProjects/mcp_sap_cc/dist/index.js`, `NODE_TLS_REJECT_UNAUTHORIZED=0`. Tools: `sapObjName`, `sapObjDetail`, `sapObjSource`, `sapTransporte`, `sapGetConfig`
- **Git-Repository** eingerichtet: Branch `develop`, Remote `https://github.com/DionJMO/ZLE_AUST_APPL_LOG.git`

---

## Aktueller Projektstand

### Meilensteine
| # | Status | Meilenstein | Deadline |
|---|---|---|---|
| M1–M4 | ✅ fertig | ABAP-Klassen, Logging, ICF-Handler, Unit-Tests | KW 21–24 |
| **M5** | ⚠️ laufend | Fiori App v1: 5/5 Kacheln ✅, nur KPI-Kachel fehlt noch | **KW 25 / 20.06.2026** |
| M6 | — | ME-Umrechnung + `ZLE_AUST_ME_NACHBUCH` | KW 26 |
| M7 | ✅ fertig | `ZCL_ZLE_AUST_OUTBOUND` + Auftragskategorien | KW 27 |
| M8 | — | Fiori App v2: JSON-Viewer, Stornierung | KW 28 |

### Fiori OVP App – Stand
| Kachel | Status | Anmerkung |
|---|---|---|
| Application Log (`appLogCard`) | ✅ fertig | Service Binding `ZLE_AUST_SB_APPL_LOG` published |
| Abbruchmaterialien (`abbruchCard`) | ✅ fertig | Nutzt AppLog-Service, Filter LogType=E |
| Kontakte (`kontakteCard`) | ✅ fertig | Statisch, kein Backend nötig |
| Einlageraufträge (`tpaCard`) | ✅ fertig | `ZLE_AUST_SB_TPA` published (O-18 ✅) |
| KPI-Zeile | ❌ fehlt | Nach TPA-Service: Aggregation aus `ZLE_AUST_TPA` |

---

## Nächste Schritte (priorisiert)

### Sofort (M5-Deadline 20.06.2026)
1. **In ADT: `ZLE_AUST_TPA` aktivieren** → Tabelle aus [abap_files/ZLE_AUST_TPA.abap](abap_files/ZLE_AUST_TPA.abap)
2. **In ADT: `ZLE_AUST_I_TPA` + `ZLE_AUST_C_TPA` aktivieren** → CDS Views aus abap_files/
3. **In ADT: `ZLE_AUST_SD_TPA` aktivieren** → Service Definition aus abap_files/
4. **In ADT: `ZLE_AUST_SB_TPA` anlegen + publishen** → OData V4 – UI (O-18). TPA-Kachel geht dann live.
5. **KPI-Kachel** → Aggregation aus `ZLE_AUST_TPA` (Gesamt/Offen/Fehler/Abbrüche)

### Bald (parallel zu M5)
- **O-13**: SLG0-Subobjekt `APPL_LOG` registrieren (Kroschke IT)
- **O-11/O-17**: `ZLE_AUST_HIST_TYPE`-Festwerte in SE11 auf `IB_GET`, `IB_CREATE` etc. anpassen
- **O-19** ✅: TPA-Sync-Report `ZLE_AUST_TPA_SYNC` implementiert + aktiviert (16.06.2026)

### M6-Vorbereitung
- **O-15**: Strukturen `ZLE_AUST_S_ITEM` + `ZLE_AUST_S_ITEM_LIST` anlegen (Feldmapping in CLAUDE.md)

---

## Offene Punkte (Auszug)

| # | Prio | Thema |
|---|---|---|
| O-09 | Mittel | `@UI.facets` nicht aktivierbar – Detail-Seite via Metadata Extension (M8) |
| O-11 | Mittel | `ZLE_AUST_HIST_TYPE` Festwerte in SE11 anpassen |
| O-12 | Mittel | `mv_last_http_status` in `ZCL_ZLE_AUST_BASE_OAUTH` – HTTP-Status vor Exception setzen |
| O-13 | Mittel | SLG0-Subobjekt `APPL_LOG` registrieren |
| O-15 | **Hoch** | `ZLE_AUST_S_ITEM` + `ZLE_AUST_S_ITEM_LIST` anlegen |
| O-16 | Niedrig | `ZLE_AUST_ITEM_EXPORT` – Zweck klären |
| O-17 | Mittel | `ZLE_AUST_HIST_TYPE` um `ITEM_GET`, `ITEM_CREATE` etc. erweitern |
| O-18 | ✅ erledigt | `ZLE_AUST_SB_TPA` published, TPA-Kachel live |
| O-19 | ✅ erledigt | TPA-Sync-Report `ZLE_AUST_TPA_SYNC` aktiviert |

---

## Wichtige Dateien

| Datei | Inhalt |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Vollständige Projektdoku – Single Source of Truth |
| [extra/ZLE_AUST_LOG_ENTWICKLUNGSKONZEPT.md](extra/ZLE_AUST_LOG_ENTWICKLUNGSKONZEPT.md) | Entwicklungskonzept v1.2 |
| [webapp/manifest.json](webapp/manifest.json) | OVP-Konfiguration (4 von 5 Kacheln konfiguriert) |
| [webapp/annotations/annotation.xml](webapp/annotations/annotation.xml) | AppLog + Abbruch-Annotationen |
| [webapp/annotations/tpaAnnotation.xml](webapp/annotations/tpaAnnotation.xml) | TPA-Annotationen |
| [webapp/i18n/i18n.properties](webapp/i18n/i18n.properties) | Alle i18n-Texte |
| [webapp/localService/mainService/metadata.xml](webapp/localService/mainService/metadata.xml) | OData V4 Mockdaten AppLog |
| [webapp/localService/tpaService/metadata.xml](webapp/localService/tpaService/metadata.xml) | OData V4 Mockdaten TPA |
| [abap_files/ZLE_AUST_TPA.abap](abap_files/ZLE_AUST_TPA.abap) | TPA-Puffertabelle DDL |
| [abap_files/ZLE_AUST_C_TPA.abap](abap_files/ZLE_AUST_C_TPA.abap) | TPA Consumption View (ohne @UI.facets) |
| [abap_files/ZLE_AUST_SD_TPA.abap](abap_files/ZLE_AUST_SD_TPA.abap) | TPA Service Definition |
| [abap_files/ZLE_AUST_C_APPL_LOG.abap](abap_files/ZLE_AUST_C_APPL_LOG.abap) | AppLog Consumption View (ohne @UI.facets) |

---

## MCP-Tools

- **Atlassian MCP** (`kroschke.atlassian.net`) – Confluence-Space `SPE` für Projektdoku
- **SAP-CC MCP** – direkte Verbindung zu C01 (`c01ap.kroschke.com:52201`), in jeder Session verfügbar als `mcp__sap-cc__*`

---

## Nützliche Links (Confluence SPE)

- [AHS4 – Anbindung S4/HANA an HiLIS](https://kroschke.atlassian.net/wiki/spaces/SPE/pages/805732406) – technische Hauptdoku, Feldmapping (Stand 03.06.2026)
- [20.03.2026 – Abstimmung Artikel Anlage](https://kroschke.atlassian.net/wiki/spaces/SPE/pages/805142616) – finale SAP-Feldzuordnungen für `ZLE_AUST_S_ITEM`
