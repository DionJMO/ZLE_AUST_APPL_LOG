import BaseComponent from "sap/ovp/app/Component";
import Button from "sap/m/Button";
import OverflowToolbar from "sap/m/OverflowToolbar";
import ToolbarSpacer from "sap/m/ToolbarSpacer";
import UI5Element from "sap/ui/core/Element";
import Table from "sap/m/Table";
import Toolbar from "sap/m/Toolbar";
import Dialog from "sap/m/Dialog";
import CheckBox from "sap/m/CheckBox";
import VBox from "sap/m/VBox";
import FlexBox from "sap/m/FlexBox";
import Title from "sap/m/Title";
import MessageToast from "sap/m/MessageToast";
import Sorter from "sap/ui/model/Sorter";
import InteractiveDonutChart, {
	InteractiveDonutChart$SelectionChangedEvent,
	InteractiveDonutChart$PressEvent
} from "sap/suite/ui/microchart/InteractiveDonutChart";
import InteractiveDonutChartSegment from "sap/suite/ui/microchart/InteractiveDonutChartSegment";
import { ValueColor, FlexAlignItems, FlexJustifyContent } from "sap/m/library";

interface ModelLike {
	getMetaModel(): Record<string, unknown>;
}

/**
 * @namespace zui5_zle_aust_mon
 */
export default class Component extends BaseComponent {

	public static metadata = {
		manifest: "json"
	};

	public init(): void {
		// @ts-expect-error - OVP BaseComponent.init() not typed in sap/ovp/app/Component
		super.init();
		this._shimV4MetaModels();
		setTimeout(() => { this._initColumnPersonalization(0); }, 1000);
		setTimeout(() => this._buildTypeChart(), 1000);
	}

	private _shimV4MetaModels(): void {
		const self = this as unknown as { getModel(name: string): ModelLike | undefined };
		["mainModel", "tpaModel"].forEach((sModelName: string) => {
			const oModel = self.getModel(sModelName);
			if (!oModel) { return; }
			const oMeta = oModel.getMetaModel();
			if (typeof oMeta.getODataEntitySet === "function") { return; }
			oMeta.getODataEntitySet = (sName: string) => ({ name: sName, entityType: sName });
			oMeta.getODataEntityType = () => ({});
		});
	}

	private _buildTypeChart(iRetry = 0): void {
		// Avoid double-injection
		if (document.getElementById("__zleTypeChart")) { return; }

		// Find rendered OVP table cards via the control registry (no dependency
		// on OVP-internal CSS class names, which differ per containerLayout).
		const aDomRefs = (UI5Element.registry.filter((el) => el.isA("sap.m.Table")) as any[])
			.map((t) => t.getDomRef?.() as HTMLElement | null)
			.filter((d): d is HTMLElement => !!d);

		// Need at least two cards to derive the shared container reliably
		if (aDomRefs.length < 2) {
			if (iRetry < 20) {
				setTimeout(() => this._buildTypeChart(iRetry + 1), 500);
			} else {
				// eslint-disable-next-line no-console
				console.warn("[Chart] Zu wenige gerenderte Tabellen — Diagramm wird nicht angezeigt.");
			}
			return;
		}

		// Lowest common ancestor of all table DOM nodes = the OVP card container
		let oContainer: HTMLElement | null = aDomRefs[0];
		for (let i = 1; i < aDomRefs.length && oContainer; i++) {
			while (oContainer && !oContainer.contains(aDomRefs[i])) {
				oContainer = oContainer.parentElement;
			}
		}

		// Reference card = the container's direct child that holds the first table
		let oRefCard: HTMLElement | null = aDomRefs[0];
		while (oRefCard && oRefCard.parentElement !== oContainer) {
			oRefCard = oRefCard.parentElement;
		}

		if (!oContainer || !oRefCard) {
			if (iRetry < 20) { setTimeout(() => this._buildTypeChart(iRetry + 1), 500); }
			return;
		}

		// eslint-disable-next-line no-console
		console.log("[Chart] Kachel-Container gefunden:", oContainer.className,
			"– Kacheln:", oContainer.children.length);

		// Create the chart card and copy the box metrics from a real neighbour card,
		// so it matches whatever layout OVP uses (flex or grid).
		const oDiv = document.createElement("div");
		oDiv.id = "__zleTypeChart";
		oDiv.className = "zleChartCard";
		const cs = window.getComputedStyle(oRefCard);
		oDiv.style.flex = cs.flex;
		oDiv.style.width = cs.width;
		oDiv.style.height = cs.height;
		oDiv.style.margin = cs.margin;
		oContainer.insertBefore(oDiv, oRefCard);

		// Render the chart shell right away, so it always shows
		this._createTypeChart().placeAt("__zleTypeChart");

		// Load the counts and fill in the segments afterwards
		void this._loadTypeCounts();
	}

	private async _loadTypeCounts(): Promise<void> {
		try {
			const oModel = (this as any).getModel("mainModel") as any;

			// Sort newest first (field name only → no DateTimeOffset literal issue),
			// select only the two fields we need, and apply the 14-day cutoff client-side.
			const oBinding = oModel.bindList(
				"/AppLog", null, [new Sorter("CreatedAt", true)], undefined,
				{ $select: "LogType,CreatedAt" }
			);
			const aCtx: any[] = await oBinding.requestContexts(0, 2000);

			const nCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
			const counts: Record<string, number> = { E: 0, W: 0, S: 0 };
			for (const oCtx of aCtx) {
				const oRow = oCtx.getObject() as Record<string, string> | undefined;
				if (!oRow) { continue; }
				const sType = oRow["LogType"] ?? "";
				const sCreated = oRow["CreatedAt"];
				const nCreated = sCreated ? new Date(sCreated).getTime() : 0;
				if (nCreated >= nCutoff && sType in counts) { counts[sType]++; }
			}

			// eslint-disable-next-line no-console
			console.log("[Chart] Zähler (14 Tage):", counts, "aus", aCtx.length, "geladenen Einträgen");

			const nTotal = counts.E + counts.W + counts.S;
			Component.CHART_DEFS.forEach(({ key, label }) => {
				const nPct = nTotal > 0 ? Math.round((counts[key] / nTotal) * 100) : 0;
				this.mSegments[key]?.setValue(counts[key]);
				this.mSegments[key]?.setDisplayedValue(`${nPct}%`);
				// absolute count kept in the label so it isn't lost
				this.mSegments[key]?.setLabel(`${label} (${counts[key]})`);
			});
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[Chart] Fehler beim Laden der Zähler:", e);
			Component.CHART_DEFS.forEach(({ key }) => {
				this.mSegments[key]?.setDisplayedValue("?");
			});
		}
	}

	private static readonly CHART_DEFS = [
		{ key: "E", label: "Fehler",    color: ValueColor.Error    },
		{ key: "W", label: "Warnungen", color: ValueColor.Critical },
		{ key: "S", label: "Erfolg",    color: ValueColor.Good     }
	];

	private mSegments: Record<string, InteractiveDonutChartSegment> = {};

	private _onSegmentSelected(oEvent: InteractiveDonutChart$SelectionChangedEvent): void {
		const oSegment = oEvent.getParameter("segment");
		if (!oSegment) { return; }
		const sLabel = oSegment.getLabel();
		const sState = oSegment.getSelected() ? "ausgewählt" : "abgewählt";
		MessageToast.show(`${sLabel}: ${sState}`);
	}

	private _createTypeChart(): VBox {
		this.mSegments = {};

		const aSegments = Component.CHART_DEFS.map(({ key, label, color }) => {
			const oSeg = new InteractiveDonutChartSegment({
				label,
				value: 0,
				displayedValue: "…",
				color
			});
			this.mSegments[key] = oSeg;
			return oSeg;
		});

		const oChart = new InteractiveDonutChart({
			selectionEnabled: true,
			segments: aSegments,
			selectionChanged: (oEvent: InteractiveDonutChart$SelectionChangedEvent) => {
				this._onSegmentSelected(oEvent);
			},
			press: () => {
				MessageToast.show("Diagramm gedrückt.");
			}
		});

		// Sample pattern: wrap the chart in a fixed-size FlexBox so the
		// segment legend (label + value) renders properly.
		const oFlex = new FlexBox({
			width: "25rem",
			height: "11rem",
			alignItems: FlexAlignItems.Start,
			justifyContent: FlexJustifyContent.SpaceBetween,
			items: [oChart]
		}).addStyleClass("zleTypeDonut");

		return new VBox({
			items: [
				new Title({ text: "Typ-Verteilung (14 Tage)", level: "H4" })
					.addStyleClass("zleChartTitle"),
				oFlex
			]
		}).addStyleClass("zleChartBox");
	}

	private _initColumnPersonalization(iRetry: number): void {
		const aTables = UI5Element.registry.filter(
			(oEl) => oEl.isA("sap.m.Table")
		) as unknown as Table[];

		if (aTables.length === 0 && iRetry < 8) {
			setTimeout(() => { this._initColumnPersonalization(iRetry + 1); }, 500);
			return;
		}

		aTables.forEach((oTable) => {
			if (oTable.getHeaderToolbar()) { return; }
			if (oTable.getColumns().length === 0) { return; }

			// Verhindert Kartenexpansion: zu viele Spalten → Pop-in statt Breite
			oTable.setAutoPopinMode(false);

			this._setupTableTooltips(oTable);
			oTable.attachUpdateFinished(() => { this._setupTableTooltips(oTable); });

			const storageKey = "colVis_" + oTable.getId();

			// tpaCard originally had 8 visible columns; all others had 4
			const nDefault = oTable.getId().toLowerCase().includes("tpa") ? 8 : 4;

			const aSaved: boolean[] | null = JSON.parse(localStorage.getItem(storageKey) ?? "null");
			if (aSaved) {
				oTable.getColumns().forEach((col, i) => {
					if (aSaved[i] !== undefined) { col.setVisible(aSaved[i]); }
				});
			} else {
				oTable.getColumns().forEach((col, i) => { col.setVisible(i < nDefault); });
			}

			const oBtn = new Button({
				icon:    "sap-icon://action-settings",
				tooltip: "Spalten konfigurieren",
				type:    "Transparent"
			});
			oTable.setHeaderToolbar(new OverflowToolbar({
				content: [new ToolbarSpacer(), oBtn]
			}) as unknown as Toolbar);

			oBtn.attachPress(() => { this._openColumnDialog(oTable, storageKey); });
		});
	}

	private _openColumnDialog(oTable: Table, storageKey: string): void {
		const aColumns = oTable.getColumns();

		const aCheckBoxes = aColumns.map((oCol, i) => {
			const oHeader = oCol.getHeader();
			const sText = oHeader && typeof (oHeader as any).getText === "function"
				? (oHeader as any).getText() as string
				: `Spalte ${i + 1}`;
			return new CheckBox({ text: sText, selected: oCol.getVisible() });
		});

		const oDialog = new Dialog({
			title: "Spalten konfigurieren",
			content: [new VBox({ items: aCheckBoxes })],
			beginButton: new Button({
				text: "OK",
				type: "Emphasized",
				press: () => {
					aColumns.forEach((col, i) => { col.setVisible(aCheckBoxes[i].getSelected()); });
					localStorage.setItem(storageKey, JSON.stringify(aColumns.map(c => c.getVisible())));
					oDialog.close();
				}
			}),
			endButton: new Button({ text: "Abbrechen", press: () => oDialog.close() }),
			afterClose: () => oDialog.destroy()
		});
		oDialog.open();
	}

	private _setupTableTooltips(oTable: Table): void {
		(oTable.getItems() as unknown as UI5Element[]).forEach((oItem) => {
			if (!oItem.isA("sap.m.ColumnListItem")) { return; }
			const oCLI = oItem as unknown as { getCells(): UI5Element[] };
			oCLI.getCells().forEach((oCell) => {
				type CellLike = {
					getTooltip(): unknown;
					getBindingInfo(prop: string): Record<string, unknown> | undefined;
					bindProperty(prop: string, info: object): void;
				};
				const c = oCell as unknown as CellLike;
				if (c.getTooltip()) { return; }
				const oBI = c.getBindingInfo("text");
				if (!oBI) { return; }
				c.bindProperty("tooltip", this._safeCloneBindingInfo(oBI));
			});
		});
	}

	private _safeCloneBindingInfo(oBI: Record<string, unknown>): object {
		// Composite binding (parts array)
		if (Array.isArray(oBI.parts)) {
			return {
				parts: (oBI.parts as Record<string, unknown>[]).map((p) => {
					const cp: Record<string, unknown> = { path: p.path };
					if (p.model) { cp.model = p.model; }
					return cp;
				}),
				...(oBI.formatter ? { formatter: oBI.formatter } : {})
			};
		}
		// Simple path binding
		const oClean: Record<string, unknown> = { path: oBI.path };
		if (oBI.model) { oClean.model = oBI.model; }
		if (oBI.formatter) { oClean.formatter = oBI.formatter; }
		return oClean;
	}
}
