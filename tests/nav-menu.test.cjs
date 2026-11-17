const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { createModuleLoader } = require('./helpers/load-typescript.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const model = createModuleLoader().load('./lib/navigation/menu.ts');
const { isCurrent } = model;
// The app's modules run in their own context: copy what they return before comparing it with values made here.
const here = (value) => JSON.parse(JSON.stringify(value));
const menuFor = (role, officePage) => here(model.menuFor(role, officePage));
const site = (page) => `https://office.example.com/${page}`;
const none = () => null;
const shape = (groups) => groups.map(group => [group.title, group.items.map(item => item.label)]);

test('a crew member sees the four field tools and their own activity', () => {
  const groups = menuFor('field_worker', site);
  assert.deepEqual(shape(groups), [
    ['Field', ['Receiving (Scan)', 'Inventory', 'Count', 'Loads']],
    ['More', ['Activity']],
  ]);
  assert.deepEqual(groups.flatMap(group => group.items.map(item => item.route)),
    ['/(field)/scan', '/(field)/inventory', '/(field)/count', '/(field)/loads', '/(field)/activity']);
  assert.ok(groups.every(group => group.items.every(item => !item.url)), 'crews are sent to no office page');
});

test('office staff also see the admin screens, and the exceptions on the office site', () => {
  const groups = menuFor('office_staff', site);
  assert.deepEqual(shape(groups), [
    ['Field', ['Receiving (Scan)', 'Inventory', 'Count', 'Loads']],
    ['Admin', ['Dashboard', 'Reports', 'Activity', 'Locations', 'QR Codes']],
    ['On the office site', ['Exceptions (Work Inbox)']],
  ]);
  assert.deepEqual(groups[0].items.map(item => item.route), ['/(office)/scan', '/(office)/materials', '/(office)/count', '/(office)/loads']);
  assert.deepEqual(groups[1].items.map(item => item.route), ['/(office)/dashboard', '/(office)/reports', '/(office)/activity', '/(office)/locations', '/(office)/qr-codes']);
  assert.deepEqual(groups[2].items.map(item => [item.url, item.route]), [['https://office.example.com/work-inbox.html', undefined]]);
});

test('an administrator is also sent to the Data Browser on the office site', () => {
  const groups = menuFor('admin', site);
  assert.deepEqual(shape(groups).at(-1), ['On the office site', ['Exceptions (Work Inbox)', 'Data Browser']]);
  assert.equal(groups.at(-1).items[1].url, 'https://office.example.com/admin.html');
  assert.deepEqual(shape(groups).slice(0, 2), shape(menuFor('office_staff', site)).slice(0, 2));
});

test('a build with no office site lists no office pages rather than another site', () => {
  for (const role of ['office_staff', 'admin']) {
    assert.deepEqual(shape(menuFor(role, none)).map(([title]) => title), ['Field', 'Admin']);
  }
});

test('every item has a key of its own, an icon, and one place to go', () => {
  for (const role of ['field_worker', 'office_staff', 'admin']) {
    const items = menuFor(role, site).flatMap(group => group.items);
    assert.equal(new Set(items.map(item => item.key)).size, items.length, role);
    for (const item of items) {
      assert.ok(item.icon, item.key);
      assert.equal(Number(!!item.route) + Number(!!item.url), 1, `${item.key} goes to a screen or to a page`);
    }
  }
});

test('the screen now showing is the one marked, whichever tab group it is in', () => {
  const [scan, inventory] = menuFor('office_staff', site)[0].items;
  assert.equal(isCurrent(scan, '/scan'), true);
  assert.equal(isCurrent(scan, '/scan-more'), false);
  assert.equal(isCurrent(inventory, '/materials'), true);
  assert.equal(isCurrent(inventory, '/inventory'), false);
  assert.equal(isCurrent(menuFor('field_worker', site)[0].items[1], '/inventory'), true);
  const link = menuFor('admin', site).at(-1).items[0];
  assert.equal(isCurrent(link, '/work-inbox.html'), false, 'an office page is never the screen showing');
});

// ---- the button and its panel --------------------------------------------------------------------

const tokens = new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : new Proxy({}, { get: (_tokens, name) => String(name) })) });

function open(role, pathname = '/scan', { browser = async () => {} } = {}) {
  const went = [], opened = [], alerts = [];
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', Modal: 'Modal',
      Linking: { openURL: async (url) => { opened.push(url); await browser(url); } }, Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: (styles) => styles },
    },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'Icon' },
    'expo-router': { router: { navigate: (route) => went.push(route) }, usePathname: () => pathname },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/stores/authStore': { useAuthStore: (selector) => selector({ user: role ? { role } : null }) },
    '@/lib/design/tokens': tokens,
  } });
  const { NavMenu } = loader.load('./components/ui/NavMenu.tsx');
  let renderer;
  TestRenderer.act(() => { renderer = TestRenderer.create(React.createElement(NavMenu)); });
  const pressables = () => renderer.root.findAll(node => node.type === 'Pressable');
  const named = (label) => pressables().filter(node => node.props.accessibilityLabel === label);
  const press = (node) => TestRenderer.act(() => { node.props.onPress(); });
  const shown = () => renderer.root.findByType('Modal').props.visible;
  return { renderer, went, opened, alerts, pressables, named, press, shown };
}

test('the menu button opens a panel listing the screens, and either Close shuts it', () => {
  const menu = open('office_staff');
  const [trigger] = menu.named('Menu');
  assert.equal(trigger.props.accessibilityRole, 'button');
  assert.equal(menu.shown(), false);
  assert.deepEqual(here(trigger.props.accessibilityState), { expanded: false });
  menu.press(trigger);
  assert.equal(menu.shown(), true);
  assert.deepEqual(here(menu.named('Menu')[0].props.accessibilityState), { expanded: true });
  const texts = menu.renderer.root.findAll(node => node.type === 'Text').map(node => node.props.children);
  assert.deepEqual(texts, ['Menu', 'Field', 'Receiving (Scan)', 'Inventory', 'Count', 'Loads', 'Admin', 'Dashboard', 'Reports', 'Activity', 'Locations', 'QR Codes', 'On the office site', 'Exceptions (Work Inbox)']);
  // The X in the panel and the dimmed area beside it both close it; so does the hardware back button.
  const closers = menu.named('Close menu');
  assert.equal(closers.length, 2);
  for (const closer of closers) {
    menu.press(closer);
    assert.equal(menu.shown(), false);
    menu.press(menu.named('Menu')[0]);
    assert.equal(menu.shown(), true);
  }
  TestRenderer.act(() => { menu.renderer.root.findByType('Modal').props.onRequestClose(); });
  assert.equal(menu.shown(), false);
  // A screen reader's escape gesture closes it as well.
  menu.press(menu.named('Menu')[0]);
  const panel = menu.renderer.root.findAll(node => node.type === 'View' && node.props.accessibilityLabel === 'Menu')[0];
  assert.equal(panel.props.accessibilityViewIsModal, true);
  TestRenderer.act(() => { panel.props.onAccessibilityEscape(); });
  assert.equal(menu.shown(), false);
});

test('choosing a screen closes the panel and opens that screen', () => {
  const menu = open('office_staff', '/dashboard');
  menu.press(menu.named('Menu')[0]);
  const [dashboard] = menu.named('Dashboard');
  assert.deepEqual(here(dashboard.props.accessibilityState), { selected: true }, 'the screen showing is marked');
  const [loads] = menu.named('Loads');
  assert.deepEqual(here(loads.props.accessibilityState), { selected: false });
  assert.equal(loads.props.accessibilityRole, 'button');
  menu.press(loads);
  assert.deepEqual(menu.went, ['/(office)/loads']);
  assert.deepEqual(menu.opened, []);
  assert.equal(menu.shown(), false);
});

test('an office page opens in the browser and is announced as leaving the app', () => {
  const menu = open('admin');
  menu.press(menu.named('Menu')[0]);
  const [browser] = menu.named('Data Browser, opens the office site');
  assert.equal(browser.props.accessibilityRole, 'link');
  menu.press(browser);
  assert.deepEqual(menu.opened, ['https://office.example.com/admin.html']);
  assert.deepEqual(menu.went, []);
  assert.equal(menu.shown(), false);
  assert.equal(open('field_worker').named('Data Browser, opens the office site').length, 0);
});

test('an office page the phone cannot open says so instead of failing silently', async () => {
  const menu = open('admin', '/scan', { browser: async () => { throw new Error('no browser'); } });
  menu.press(menu.named('Menu')[0]);
  await TestRenderer.act(async () => { menu.named('Exceptions (Work Inbox), opens the office site')[0].props.onPress(); });
  assert.deepEqual(menu.opened, ['https://office.example.com/work-inbox.html']);
  assert.deepEqual(here(menu.alerts), [['Page not opened', "Exceptions (Work Inbox) could not be opened in this phone's browser."]]);
});

test('nobody signed in: no menu', () => {
  assert.equal(open(null).renderer.toJSON(), null);
});

// ---- the two tab layouts ---------------------------------------------------------------------------

// Draws a real layout file and returns what it hands the tab navigator: each screen's name and options, in order.
function layout(file, role) {
  let handed = null;
  const Tabs = (props) => { handed = props; return null; };
  Tabs.Screen = () => null;
  const auth = { user: { id: 'person-a', role }, activeProject: { id: 'project-a', name: 'Main Yard' }, loading: false };
  const loader = createModuleLoader({ stubs: {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', StyleSheet: { create: (styles) => styles } },
    'expo-router': { Tabs, router: { replace() {} } },
    '@expo/vector-icons/FontAwesome': { __esModule: true, default: 'Icon' },
    '@/components/screens/AccessPendingScreen': { AccessPendingScreen: 'AccessPendingScreen' },
    '@/components/ui/LoadingScreen': { LoadingScreen: 'LoadingScreen' },
    '@/components/ui/NavMenu': { NavMenu: 'NavMenu' },
    '@/components/ui/OfflineIndicator': { OfflineIndicator: 'OfflineIndicator' },
    '@/components/ui/ProjectSelector': { ProjectSelector: 'ProjectSelector' },
    '@/components/ui/SignOutButton': { SignOutButton: 'SignOutButton' },
    '@/stores/authStore': { useAuthStore: () => auth },
    '@/lib/design/tokens': tokens,
  } });
  const Layout = loader.load(`./${file}`).default;
  TestRenderer.act(() => { TestRenderer.create(React.createElement(Layout)); });
  assert.ok(handed, `${file} draws its tabs for a signed-in ${role}`);
  const screens = React.Children.toArray(handed.children).filter(child => child.type === Tabs.Screen).map(({ props }) => {
    const options = props.options ?? {};
    assert.equal(typeof options, 'object', `${props.name}: options the test can read`);
    return {
      name: props.name, title: options.title,
      // On the bottom panel unless it has no link, or draws no button of its own.
      onPanel: options.href !== null && !('tabBarButton' in options),
      icon: typeof options.tabBarIcon === 'function',
      header: options.headerShown !== false,
      menu: typeof options.headerLeft === 'function' && options.headerLeft().type === 'NavMenu',
    };
  });
  return { screens, screenOptions: handed.screenOptions ?? {} };
}
const LAYOUTS = [['field_worker', 'app/(field)/_layout.tsx', '(field)'], ['office_staff', 'app/(office)/_layout.tsx', '(office)'], ['admin', 'app/(office)/_layout.tsx', '(office)']];

test('the bottom panel is the same four field tools for crews, office staff and administrators', () => {
  for (const [role, file] of LAYOUTS) {
    const panel = layout(file, role).screens.filter(screen => screen.onPanel);
    assert.deepEqual(panel.map(screen => screen.title), ['Scan', 'Count', 'Loads', 'Inventory'], role);
    assert.ok(panel.every(screen => screen.icon && screen.header && screen.menu), `${role}: each tab has its icon, the header and the menu`);
    assert.deepEqual(panel.map(screen => screen.name), role === 'field_worker' ? ['scan', 'count', 'loads', 'inventory'] : ['scan', 'count', 'loads', 'materials'],
      role === 'field_worker' ? 'crews' : 'office users get the materials list as Inventory');
  }
});

test('every screen the menu lists exists, carries the menu, and is on the bottom panel only if it is a field tool', () => {
  for (const [role, file, group] of LAYOUTS) {
    const declared = new Map(layout(file, role).screens.map(screen => [screen.name, screen]));
    const [field, ...rest] = menuFor(role, site);
    const listed = [...field.items, ...rest.flatMap(entry => entry.items)].filter(item => item.route);
    for (const item of listed) {
      const name = item.route.split('/').pop();
      assert.equal(item.route, `/${group}/${name}`);
      assert.ok(fs.existsSync(path.join(root, 'app', group, `${name}.tsx`)), `${item.route} has a screen file`);
      const screen = declared.get(name);
      assert.ok(screen, `${file} declares ${name}`);
      assert.equal(screen.header && screen.menu, true, `${name} shows the header with the menu`);
      assert.equal(screen.onPanel, field.items.includes(item), `${role}: ${name} ${field.items.includes(item) ? 'is' : 'is not'} on the bottom panel`);
    }
    // And the other way: every screen with the menu, or on the panel, is one the menu lists.
    const names = listed.map(item => item.route.split('/').pop()).sort();
    assert.deepEqual([...declared.values()].filter(screen => screen.menu || screen.onPanel).map(screen => screen.name).sort(), names, role);
  }
});

test('the screens a step opens keep their own header, with no menu to leave a half-done step by', () => {
  for (const [role, file] of LAYOUTS) {
    const { screens, screenOptions } = layout(file, role);
    assert.equal('headerLeft' in screenOptions, false, `${file} sets no menu for all of its screens at once`);
    const steps = screens.filter(screen => !screen.menu);
    assert.ok(steps.length >= 12, role);
    for (const step of steps) {
      assert.equal(step.onPanel, false, step.name);
      assert.equal(step.header, false, `${step.name} draws its own header`);
    }
    for (const name of ['receiving', 'material-detail', 'count-item', 'load', 'load-edit', 'load-checkin', 'load-out', 'load-depart', 'load-unload', 'crate', 'pack', 'relocate']) {
      assert.ok(steps.some(step => step.name === name), `${role}: ${name}`);
    }
  }
});

test('office users still open on the Dashboard, and Android back returns to it', () => {
  assert.equal(layout('app/(office)/_layout.tsx', 'admin').screens[0].name, 'dashboard', 'the first screen is where the back button leads');
  assert.match(read('app/index.tsx'), /router\.replace\('\/\(office\)\/dashboard'\)/);
  assert.equal(layout('app/(field)/_layout.tsx', 'field_worker').screens[0].name, 'scan');
});

test('the Data Browser and Exceptions are no longer in the phone app', () => {
  for (const gone of ['app/(office)/admin.tsx', 'app/(office)/exceptions.tsx', 'components/screens/AdminScreen.tsx', 'components/modals/AdminEditModal.tsx', 'lib/api/admin.ts', 'lib/api/exceptions.ts']) {
    assert.equal(fs.existsSync(path.join(root, gone)), false, gone);
  }
  // Every route file in a tab group is declared in its layout, and nothing else is: an undeclared file would
  // appear on the bottom panel by itself.
  for (const [role, file, group] of LAYOUTS) {
    const files = fs.readdirSync(path.join(root, 'app', group)).filter(name => name !== '_layout.tsx').map(name => name.replace(/\.tsx$/, '')).sort();
    const names = layout(file, role).screens.map(screen => screen.name);
    assert.deepEqual([...names].sort(), files, file);
    assert.equal(new Set(names).size, names.length, `${file} declares each screen once`);
    assert.ok(!names.includes('admin') && !names.includes('exceptions'), file);
  }
});
