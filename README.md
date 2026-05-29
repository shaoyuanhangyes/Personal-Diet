# Personal Diet Mini Program

餐食记录微信小程序，包含首页目标跟踪、今日餐食、饮食清单和设置四个页面。

## 目录

- `miniprogram/`：小程序源码
- `cloudfunctions/login/`：微信登录云函数
- `cloudfunctions/syncDietData/`：用户资料和食物数据库同步云函数
- `project.config.json`：微信开发者工具项目配置

## 使用

1. 用微信开发者工具打开当前目录。
2. 开通云开发后，上传并部署 `login` 和 `syncDietData` 云函数。
3. 在小程序内使用微信登录后，用户资料和食物数据库会同步到云数据库。
