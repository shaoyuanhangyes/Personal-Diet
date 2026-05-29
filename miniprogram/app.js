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
  }
});
