import BaseComponent from "sap/ovp/app/Component";
import Button from "sap/m/Button";
import OverflowToolbar from "sap/m/OverflowToolbar";
import ToolbarSpacer from "sap/m/ToolbarSpacer";
import UI5Element from "sap/ui/core/Element";
import ElementRegistry from "sap/ui/core/ElementRegistry";
import Table from "sap/m/Table";
import Dialog from "sap/m/Dialog";
import CheckBox from "sap/m/CheckBox";
import VBox from "sap/m/VBox";

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
		setTimeout(() => { this._hideGlobalFilterBarWithToggle(0); }, 1000);
	}

	private _hideGlobalFilterBarWithToggle(iRetry: number): void {
		type FilterBarApiLike = {
			setVisible(b: boolean): void;
			getVisible(): boolean;
			getDomRef(): Element | null;
		};

		const aApi = ElementRegistry.filter(
			(oEl) => oEl.isA("sap.fe.macros.filterBar.FilterBarAPI")
		) as unknown as FilterBarApiLike[];

		if (aApi.length === 0 && iRetry < 8) {
			setTimeout(() => { this._hideGlobalFilterBarWithToggle(iRetry + 1); }, 500);
			return;
		}
		if (aApi.length === 0) { return; }

		const oApi = aApi[0];
		oApi.setVisible(false);

		const oToggle = new Button({
			icon: "sap-icon://slim-arrow-down",
			tooltip: "Filter einblenden",
			type: "Transparent"
		});
		oToggle.attachPress(() => {
			const bNowVisible = !oApi.getVisible();
			oApi.setVisible(bNowVisible);
			oToggle.setIcon(bNowVisible ? "sap-icon://slim-arrow-up" : "sap-icon://slim-arrow-down");
			oToggle.setTooltip(bNowVisible ? "Filter ausblenden" : "Filter einblenden");
		});

		const oDomRef = oApi.getDomRef();
		if (oDomRef?.parentElement) {
			oToggle.placeAt(oDomRef, "before");
		}
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

	private _initColumnPersonalization(iPass: number): void {
		const aTables = ElementRegistry.filter(
			(oEl) => oEl.isA("sap.m.Table")
		) as unknown as Table[];

		aTables.forEach((oTable) => {
			if (oTable.getHeaderToolbar()) { return; }          // schon verdrahtet → skip
			if (oTable.getColumns().length === 0) { return; }   // noch nicht bereit → nächster Pass

			// Verhindert Kartenexpansion: zu viele Spalten → Pop-in statt Breite
			oTable.setAutoPopinMode(false);

			// Lazy Loading: initial 25 Zeilen, beim Scroll ans Ende weitere nachladen
			oTable.setGrowing(true);
			oTable.setGrowingScrollToLoad(true);
			oTable.setGrowingThreshold(25);

			this._setupTableTooltips(oTable);
			oTable.attachUpdateFinished(() => {
				this._setupTableTooltips(oTable);
			});

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
			oBtn.attachPress(() => { this._openColumnDialog(oTable, storageKey); });

			// Only the column-config gear; card resizing is handled by OVP's
			// native drag&drop (which reflows neighbours without overlap).
			oTable.setHeaderToolbar(new OverflowToolbar({
				content: [new ToolbarSpacer(), oBtn]
			}));
		});

		// Mehrere Durchläufe: spät erzeugte Karten (Abbruch/TPA laden async nach
		// der Donut-Custom-Card) werden so ebenfalls verdrahtet. Bereits
		// verdrahtete Tabellen überspringt der getHeaderToolbar()-Guard.
		if (iPass < 15) {
			setTimeout(() => { this._initColumnPersonalization(iPass + 1); }, 700);
		}
	}

	private _openColumnDialog(oTable: Table, storageKey: string): void {
		const aColumns = oTable.getColumns();

		type HeaderWithText = { getText?: () => string };

		const aCheckBoxes = aColumns.map((oCol, i) => {
			const oHeader = oCol.getHeader() as unknown as HeaderWithText | null;
			const sText = typeof oHeader?.getText === "function"
				? oHeader.getText()
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
