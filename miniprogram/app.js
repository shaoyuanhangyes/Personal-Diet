App({
  globalData: {
    dietMealVersion: 0,
    cloudReady: false
  },
  onLaunch() {
    if (wx.cloud) {
      try {
        wx.cloud.init({ traceUser: true });
        this.globalData.cloudReady = true;
      } catch (error) {
        this.globalData.cloudReady = false;
      }
    }
  }
});
