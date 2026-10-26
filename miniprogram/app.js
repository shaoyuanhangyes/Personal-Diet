const cloudSync = require("./utils/cloud-sync");

App({
  globalData: {
    dietMealVersion: 0,
    cloudReady: false
  },
  onLaunch() {
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: "cloud1-d1gqauyb1f134f1ad",
          traceUser: true
        });
        this.globalData.cloudReady = true;
      } catch (error) {
        this.globalData.cloudReady = false;
      }
    }
    if (typeof wx.onNetworkStatusChange === "function") {
      wx.onNetworkStatusChange((status) => {
        if (status.isConnected) {
          cloudSync.retryPendingSync();
          cloudSync.refreshCalendarHistory().then((result) => {
            if (result.localOnly || typeof getCurrentPages !== "function") return;
            const pages = getCurrentPages();
            const currentPage = pages[pages.length - 1];
            if (currentPage && typeof currentPage.refreshFromCloud === "function") {
              currentPage.refreshFromCloud();
            }
          });
        }
      });
    }
  },
  onShow() {
    cloudSync.retryPendingSync();
    cloudSync.refreshCalendarHistory();
  }
});
