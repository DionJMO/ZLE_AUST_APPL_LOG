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
import Sorter from "sap/ui/model/Sorter";

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

			// Lazy Loading: initial 25 Zeilen, beim Scroll ans Ende weitere nachladen
			oTable.setGrowing(true);
			oTable.setGrowingScrollToLoad(true);
			oTable.setGrowingThreshold(25);

			this._setupTableTooltips(oTable);
			this._applyRowColors(oTable);
			oTable.attachUpdateFinished(() => {
				this._setupTableTooltips(oTable);
				this._applyRowColors(oTable);
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
			}) as unknown as Toolbar);
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

	private mLogTypeByUuid: Record<string, string> = {};
	private mLogTypeMapPromise?: Promise<void>;

	private _ensureLogTypeMap(): Promise<void> {
		if (!this.mLogTypeMapPromise) {
			this.mLogTypeMapPromise = (async () => {
				try {
					const oModel = (this as any).getModel("mainModel") as any;
					const oBinding = oModel.bindList(
						"/AppLog", null, [new Sorter("CreatedAt", true)], undefined,
						{ $select: "LogUuid,LogType" }
					);
					const aCtx: any[] = await oBinding.requestContexts(0, 2000);
					for (const oCtx of aCtx) {
						const oRow = oCtx.getObject() as Record<string, string> | undefined;
						if (oRow?.LogUuid) { this.mLogTypeByUuid[oRow.LogUuid] = oRow.LogType; }
					}
				} catch (e) {
					// eslint-disable-next-line no-console
					console.error("[Rows] LogType-Map konnte nicht geladen werden:", e);
				}
			})();
		}
		return this.mLogTypeMapPromise;
	}

	private _applyRowColors(oTable: Table): void {
		type RowLike = {
			getBindingContext(m?: string): { getProperty(p: string): unknown } | null;
			addStyleClass(s: string): void;
			removeStyleClass(s: string): void;
		};

		void this._ensureLogTypeMap().then(() => {
			(oTable.getItems() as unknown as RowLike[]).forEach((oRow) => {
				if (typeof oRow.getBindingContext !== "function" || typeof oRow.addStyleClass !== "function") {
					return;
				}
				oRow.removeStyleClass("zleRowE");
				oRow.removeStyleClass("zleRowW");
				oRow.removeStyleClass("zleRowS");

				const oCtx = oRow.getBindingContext() ?? oRow.getBindingContext("mainModel");
				const sUuid = oCtx?.getProperty("LogUuid") as string | undefined;
				if (!sUuid) { return; }

				const sType = this.mLogTypeByUuid[sUuid];
				if (sType === "E" || sType === "W" || sType === "S") {
					oRow.addStyleClass("zleRow" + sType);
				}
			});
		});
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
