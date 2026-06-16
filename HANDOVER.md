# Übergabe-Dokument – HiLIS Monitoring / ZLE_AUST
**Session:** 16.06.2026 | **Entwickler:** Dion Maring Ouambo (D.MaringOuambo@kroschke.com)

---

## Was ist dieses Projekt?

SAP-seitige Fiori OVP-Monitoring-App für die HiLIS/AutoStore-Schnittstelle bei Kroschke SIGN International GmbH (Projekt 205845). ABAP-Consumer-Klassen (`ZCL_ZLE_AUST_*`) kommunizieren per REST mit der HiLIS-Middleware. Eine Fiori OVP zeigt Log, TPAs, Abbruchmaterialien und KPIs.

Die vollständige Projektdoku steht in **[CLAUDE.md](CLAUDE.md)** – das ist die Single Source of Truth. Immer zuerst lesen.

---

## Was wurde in dieser Session gemacht?

### Fiori OVP – neue Kacheln (Session 16.06.2026)
| Was | Datei | Beschreibung |
|---|---|---|
| bundleName-Fix | [webapp/manifest.json](webapp/manifest.json) | `project1.i18n.i18n` → `zui5_zle_aust_mon.i18n.i18n` (Rest von O-14) |
| Abbruchmaterialien-Kachel | [webapp/manifest.json](webapp/manifest.json) + [annotation.xml](webapp/annotations/annotation.xml) | Neue Table-Card `abbruchCard` – selber Service wie AppLog, gefiltert auf `LogType = 'E'` via `UI.SelectionVariant#AbbruchCard` |
| Kontakte-Kachel | [webapp/manifest.json](webapp/manifest.json) | Statische Linklist-Kachel `kontakteCard` (`sap.ovp.cards.linklist`) mit Hörmann PM, WMS-Support, Kroschke IT |
| i18n-Texte | [webapp/i18n/i18n.properties](webapp/i18n/i18n.properties) | Schlüssel für `abbruchCardTitle/SubTitle` und `kontakteCardTitle/SubTitle` ergänzt |

### Vorherige Session (Fixes + Setup)
| Fix | Datei | Beschreibung |
|---|---|---|
| O-09 ✅ | [ZLE_AUST_C_APPL_LOG.abap](abap_files/ZLE_AUST_C_APPL_LOG.abap) | `@UI.facets` ergänzt → Detail-Seite zeigt jetzt `JsonPayload` |
| O-14 ✅ | [webapp/manifest.json](webapp/manifest.json) | App-ID von `project1` auf `zui5_zle_aust_mon` umgestellt |
| O-14 ✅ | [webapp/Component.ts](webapp/Component.ts) | Namespace-Kommentar angepasst |
| O-10 ✅ | – (ADT) | Service Binding `ZLE_AUST_SB_APPL_LOG` vom User in ADT published |

### MCP-Setup (abgeschlossen)
- **SAP-CC MCP** ist registriert und verbunden (user scope):
  ```
  node /mnt/c/localProjects/mcp_sap_cc/dist/index.js
  NODE_TLS_REJECT_UNAUTHORIZED=0
  ```
  → Tools: `sapObjName`, `sapObjDetail`, `sapObjSource`, `sapTransporte`, `sapTransportDetail`, `sapGetConfig`
  → Verfügbar als `mcp__sap-cc__*` in neuen Claude Code Sessions

---

## Aktueller Projektstand

### Meilensteine
| # | Status | Meilenstein | Deadline |
|---|---|---|---|
| M1–M4 | ✅ fertig | ABAP-Klassen, Logging, Unit-Tests | KW 21–24 |
| **M5** | 🔄 **in Arbeit** | Fiori App v1: KPI, TPA-Tabelle, Log-Kachel | **KW 25 / 20.06.2026** |
| M6 | – | ME-Umrechnung + `ZLE_AUST_ME_NACHBUCH` | KW 26 |
| M7 | – | `ZCL_ZLE_AUST_OUTBOUND` | KW 27 |

### Fiori OVP App – Stand
| Kachel | Status |
|---|---|
| Application Log (`appLogCard`) | ✅ fertig – Service Binding published |
| Abbruchmaterialien (`abbruchCard`) | ✅ fertig – renutzt AppLog-Service, Filter LogType=E |
| Kontakte (`kontakteCard`) | ✅ fertig – statisch, kein Backend nötig |
| KPI-Zeile | ❌ fehlt – braucht Aggregations-Service (s. Architekturentscheidung unten) |
| Einlageraufträge (TPAs) | ❌ fehlt – braucht InboundOrders-Service (s. Architekturentscheidung unten) |

---

## Offene Kernfrage für M5 – TPA-Kachel & KPI

Die **TPA-Kachel und KPI-Zeile** brauchen InboundOrders-Daten aus HiLIS. Es gibt noch keinen OData-Service dafür.

**Option A – Puffertabelle** (empfohlen, sauber)
- Neue SAP-Tabelle `ZLE_AUST_TPA` als Puffer
- Hintergrundauftrag / Report ruft `ZCL_ZLE_AUST_INBOUND.GET_ORDER_LIST` auf und schreibt Ergebnis in Tabelle
- CDS View Entity + Service Binding darüber → OVP-Kachel liest aus SAP-DB
- Vorteil: Filterbar, sortierbar, OVP funktioniert nativ; Nachteil: Daten nicht live (Polling-Intervall)

**Option B – OData V4 Custom Function** (schneller für M5-Deadline)
- RAP-Aktion oder Custom DPC-Klasse, die HiLIS live aufruft
- Komplexer in ABAP V4 ohne RAP; OVP braucht EntitySet, nicht Action

**Empfehlung**: Option A. Der Puffer-Ansatz ist ABAP-Standard und passt zur bestehenden Architektur (`ZCL_ZLE_AUST_INBOUND` ist fertig). Report zum Befüllen kann in M5 als Minimalversion auch manuell ausgeführt werden.

---

## Offene Punkte (aus CLAUDE.md)

| # | Prio | Thema |
|---|---|---|
| O-09 | ✅ erledigt | `@UI.facets` in Consumption View |
| O-10 | ✅ erledigt | Service Binding published |
| O-11 | Mittel | `ZLE_AUST_HIST_TYPE` Festwerte in SE11 anpassen (IB_GET etc.) |
| O-12 | Mittel | `mv_last_http_status` in `ZCL_ZLE_AUST_BASE` – HTTP-Status vor Exception setzen |
| O-13 | Mittel | SLG0-Subobjekt `APPL_LOG` registrieren |
| O-14 | ✅ erledigt | App-ID + bundleName `project1` → `zui5_zle_aust_mon` |
| O-15 | **Hoch** | `ZLE_AUST_S_ITEM` + `ZLE_AUST_S_ITEM_LIST` anlegen |
| O-16 | Niedrig | `ZLE_AUST_ITEM_EXPORT.abap` – Zweck klären |
| O-17 | Mittel | `ZLE_AUST_HIST_TYPE` um Item-Werte erweitern |

---

## Wichtige Dateien

| Datei | Inhalt |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Vollständige Projektdoku – Single Source of Truth |
| [abap_files/ZCL_ZLE_AUST_BASE.abap](abap_files/ZCL_ZLE_AUST_BASE.abap) | Basis-Consumer: HTTP, Logging, `ensure_connected` |
| [abap_files/zcl_zle_aust_inbound.abap](abap_files/zcl_zle_aust_inbound.abap) | WE-Consumer (9 Methoden) |
| [abap_files/zcl_zle_aust_item.abap](abap_files/zcl_zle_aust_item.abap) | Item-Consumer (6 Methoden) |
| [abap_files/ZLE_AUST_C_APPL_LOG.abap](abap_files/ZLE_AUST_C_APPL_LOG.abap) | Consumption CDS View |
| [webapp/manifest.json](webapp/manifest.json) | OVP-Konfiguration (3 von 5 Kacheln fertig) |
| [webapp/annotations/annotation.xml](webapp/annotations/annotation.xml) | UI-Annotationen (AppLog + Abbruch) |
| [webapp/i18n/i18n.properties](webapp/i18n/i18n.properties) | Alle i18n-Texte |
| [webapp/localService/mainService/metadata.xml](webapp/localService/mainService/metadata.xml) | OData V4 Mockdaten |
| [extra/ZLE_AUST_LOG_ENTWICKLUNGSKONZEPT.md](extra/ZLE_AUST_LOG_ENTWICKLUNGSKONZEPT.md) | Entwicklungskonzept v1.1 |

---

## Nützliche Links (Confluence SPE)

- [AHS4 – Anbindung S4/HANA an HiLIS](https://kroschke.atlassian.net/wiki/spaces/SPE/pages/805732406) – technische Hauptdoku, Feldmapping (Stand 03.06.2026)
- [20.03.2026 – Abstimmung Artikel Anlage](https://kroschke.atlassian.net/wiki/spaces/SPE/pages/805142616) – finale SAP-Feldzuordnungen für `ZLE_AUST_S_ITEM`

---

## MCP-Tools

- **Atlassian MCP** (`kroschke.atlassian.net`) – Confluence-Space `SPE` für Projektdoku
- **SAP-CC MCP** – direkte Verbindung zu C01 (`c01ap.kroschke.com:52201`), ab sofort in jeder Session verfügbar

---

## Empfohlene nächste Schritte

1. **Architekturentscheidung TPA-Kachel bestätigen** – Option A (Puffertabelle `ZLE_AUST_TPA`) empfohlen
2. **Puffertabelle + CDS + Service für TPA anlegen** (M5-Kernaufgabe)
3. **TPA-Kachel in OVP einbinden** – analog zu `appLogCard`, neues EntitySet `TPA`
4. **KPI-Zeile** – nach TPA-Service: Aggregation aus `ZLE_AUST_TPA` (Gesamt/Offen/Fehler)
5. **`ZLE_AUST_S_ITEM` anlegen** (O-15) – Feldmapping fertig in CLAUDE.md
