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
					getBindingInfo(prop: string): object | undefined;
					bindProperty(prop: string, info: object): void;
				};
				const c = oCell as unknown as CellLike;
				if (c.getTooltip()) { return; }
				const oBI = c.getBindingInfo("text");
				if (!oBI) { return; }
				c.bindProperty("tooltip", JSON.parse(JSON.stringify(oBI)) as object);
			});
		});
	}
}
