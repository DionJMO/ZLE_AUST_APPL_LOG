sap.ui.define([
	"sap/ui/model/Sorter",
	"sap/m/MessageToast"
], function (Sorter, MessageToast) {
	"use strict";

	var SEGS = [
		{ key: "E", label: "Fehler",    id: "segE" },
		{ key: "W", label: "Warnungen", id: "segW" },
		{ key: "S", label: "Erfolg",    id: "segS" }
	];

	return {

		onAfterRendering: function () {
			if (this._zleDonutLoaded) { return; }
			this._zleDonutLoaded = true;

			var that = this;
			var oView = this.getView();
			var oModel = (oView && (oView.getModel("mainModel") || oView.getModel())) || null;
			if (!oModel) {
				// eslint-disable-next-line no-console
				console.error("[Donut] kein Modell verfügbar");
				return;
			}

			var oBinding = oModel.bindList(
				"/AppLog", null, [new Sorter("CreatedAt", true)], undefined,
				{ $select: "LogType,CreatedAt" }
			);
			oBinding.requestContexts(0, 2000).then(function (aCtx) {
				var nCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
				var counts = { E: 0, W: 0, S: 0 };
				aCtx.forEach(function (oCtx) {
					var oRow = oCtx.getObject();
					if (!oRow) { return; }
					var sType = oRow.LogType || "";
					var nCreated = oRow.CreatedAt ? new Date(oRow.CreatedAt).getTime() : 0;
					if (nCreated >= nCutoff && counts.hasOwnProperty(sType)) { counts[sType]++; }
				});

				var nTotal = counts.E + counts.W + counts.S;
				SEGS.forEach(function (oDef) {
					var oSeg = that.byId(oDef.id);
					if (!oSeg) { return; }
					var nPct = nTotal > 0 ? Math.round((counts[oDef.key] / nTotal) * 100) : 0;
					oSeg.setValue(counts[oDef.key]);
					oSeg.setDisplayedValue(nPct + "%");
					oSeg.setLabel(oDef.label + " (" + counts[oDef.key] + ")");
				});
			}).catch(function (e) {
				// eslint-disable-next-line no-console
				console.error("[Donut] Fehler beim Laden der Zähler:", e);
			});
		},

		onSelectionChanged: function (oEvent) {
			var oSegment = oEvent.getParameter("segment");
			if (!oSegment) { return; }
			var sState = oSegment.getSelected() ? "ausgewählt" : "abgewählt";
			MessageToast.show(oSegment.getLabel() + ": " + sState);
		},

		onPress: function () {
			MessageToast.show("Diagramm gedrückt.");
		}
	};
});
