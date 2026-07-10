// electron-vite asset imports (main/preload): `import icon from '...png?asset'` → đường dẫn file lúc chạy.
declare module '*?asset' {
  const src: string
  export default src
}
