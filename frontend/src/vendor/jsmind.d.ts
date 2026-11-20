// 声明从 ari-demo.html 提取的 jsMind 0.8.7 UMD 包（保留 BSD 许可）。
// 作为副作用导入（浏览器里设置 window.jsMind），页面经 window.jsMind 使用。

declare global {
  interface Window {
    jsMind: any;
  }
}

export {};
