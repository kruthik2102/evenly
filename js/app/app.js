// Shared app handle. main.js fills it in; screens import it.
//   app.store          the Store
//   app.show(screen)   open a detail screen (detail column on tablets, pushed on phones)
//   app.present(screen, opts) → sheet api
//   app.wide           true when the split view is showing

export const app = {
  store: null,
  wide: false,
  show() {},
  present() {},
  refresh() {},
  selectTab() {},
};
