import { mixColor, onColor, readableColor } from './color.mjs';

// One small application-owned palette catalog, not an editable style engine.
// A palette's mode also drives the browser's built-in widgets.
const definitions = [
  { id: 'light', name: 'Sage Daybreak', mode: 'light', description: 'Fresh paper and soft greens.',
    bg: '#f8f9f6', paper: '#ffffff', sidebar: '#eef1ec', text: '#252d2a', muted: '#68726b', line: '#e1e7df', accent: '#426b4c', tint: '#e4eddf', hover: '#e8ede5' },
  { id: 'dark', name: 'Forest Night', mode: 'dark', description: 'Charcoal with a calm green accent.',
    bg: '#171c19', paper: '#1e2520', sidebar: '#121814', text: '#e4ebe2', muted: '#9aa99b', line: '#303c33', accent: '#a5c695', tint: '#293c2a', hover: '#263127' },
  { id: 'sandstone', name: 'Desert Clay', mode: 'light', description: 'Warm ivory, sand, and terracotta.',
    bg: '#faf6ee', paper: '#fffdf8', sidebar: '#f1e9dc', text: '#352c26', muted: '#756758', line: '#e3d7c5', accent: '#9b4b32', tint: '#f3e3d5', hover: '#eee3d5' },
  { id: 'midnight', name: 'Blue Hour', mode: 'dark', description: 'Deep navy with clear blue highlights.',
    bg: '#101827', paper: '#172237', sidebar: '#0c1321', text: '#e4edf9', muted: '#a1b2cb', line: '#2c3e58', accent: '#85b9ff', tint: '#233854', hover: '#203149' },
  { id: 'coast', name: 'Coastal Teal', mode: 'light', description: 'Sea-glass blue with a calm, clear accent.',
    bg: '#f4f8f8', paper: '#ffffff', sidebar: '#e5f0f0', text: '#173238', muted: '#61777a', line: '#d5e3e4', accent: '#0d6975', tint: '#d9edef', hover: '#e7f2f2' },
  { id: 'lilac', name: 'Amethyst Mist', mode: 'light', description: 'Soft lavender with a deep violet accent.',
    bg: '#f8f3fb', paper: '#fffdfd', sidebar: '#eee5f5', text: '#332741', muted: '#776681', line: '#e2d7ed', accent: '#70449f', tint: '#eadcf5', hover: '#f0e8f5' },
  { id: 'ember', name: 'Ember Amber', mode: 'dark', description: 'Smoked plum with a warm amber glow.',
    bg: '#25141d', paper: '#351d2a', sidebar: '#190d14', text: '#f5e4ea', muted: '#c6a2b2', line: '#523143', accent: '#ffab68', tint: '#51283a', hover: '#402432' },
  { id: 'aurora', name: 'Aurora Green', mode: 'dark', description: 'Deep evergreen with a luminous mint accent.',
    bg: '#10271e', paper: '#19372a', sidebar: '#091a13', text: '#e5f2e9', muted: '#a0c0aa', line: '#2b4c39', accent: '#6ddd98', tint: '#204832', hover: '#263d30' },
  { id: 'porcelain', name: 'Glacier Cobalt', mode: 'light', description: 'Cool porcelain and tailored cobalt.',
    bg: '#f2f5fa', paper: '#ffffff', sidebar: '#e4ebf6', text: '#202b43', muted: '#61718c', line: '#d8e1ef', accent: '#365caa', tint: '#dfe9fb', hover: '#eaf0f8' },
  { id: 'rosewater', name: 'Garnet Blush', mode: 'light', description: 'Powdered blush with a garnet finish.',
    bg: '#fbf4f3', paper: '#fffdfb', sidebar: '#f2e4e5', text: '#402b34', muted: '#806871', line: '#e8d6da', accent: '#a13c59', tint: '#f5dfe7', hover: '#f4e7e9' },
  { id: 'matcha', name: 'Matcha Olive', mode: 'light', description: 'Creamy matcha and pressed olive.',
    bg: '#f8f6e9', paper: '#fdfcf5', sidebar: '#e9e8d1', text: '#353722', muted: '#74734f', line: '#dcddc2', accent: '#6a7024', tint: '#e9e9c8', hover: '#efeedb' },
  { id: 'marigold', name: 'Golden Ochre', mode: 'light', description: 'Buttercream paper and golden ochre.',
    bg: '#fff6e8', paper: '#fffdf8', sidebar: '#f5e6ca', text: '#41301f', muted: '#796448', line: '#e7d7b7', accent: '#9b5e12', tint: '#f8e6c2', hover: '#f7edd9' },
  { id: 'graphite', name: 'Graphite Coral', mode: 'dark', description: 'Soft graphite with a coral spark.',
    bg: '#191b20', paper: '#24272e', sidebar: '#121419', text: '#f0ede9', muted: '#adb0b6', line: '#3a3e46', accent: '#ff947e', tint: '#433033', hover: '#30333a' },
  { id: 'mulberry', name: 'Mulberry Orchid', mode: 'dark', description: 'Velvet violet and orchid light.',
    bg: '#201826', paper: '#2d2133', sidebar: '#170f1d', text: '#f2e8f4', muted: '#bca9c4', line: '#49364f', accent: '#dca0e4', tint: '#403048', hover: '#392b40' },
  { id: 'fjord', name: 'Fjord Sky', mode: 'dark', description: 'Slate-blue depths and glacial cyan.',
    bg: '#18242d', paper: '#24343f', sidebar: '#101a21', text: '#e7eff2', muted: '#afc0c7', line: '#3a4e59', accent: '#8dc8e8', tint: '#2c4654', hover: '#2d3d46' },
  { id: 'espresso', name: 'Espresso Brass', mode: 'dark', description: 'Dark roast warmth with a soft brass glow.',
    bg: '#241b17', paper: '#322721', sidebar: '#19130f', text: '#f5ede3', muted: '#c2ad9b', line: '#514036', accent: '#e8bb77', tint: '#493829', hover: '#3e3029' },
  { id: 'glacier', name: 'Arctic Blue', mode: 'light', description: 'Icy blue-white with a crisp arctic blue accent.',
    bg: '#f3f8fc', paper: '#ffffff', sidebar: '#e5eff7', text: '#253645', muted: '#667e91', line: '#d7e4ed', accent: '#28729c', tint: '#dceef8', hover: '#e8f2f8' },
  { id: 'sakura', name: 'Sakura Violet', mode: 'light', description: 'Orchid-tinted petals with a soft violet accent.',
    bg: '#dac6e2', paper: '#fffdfd', sidebar: '#ceb5d8', text: '#392b40', muted: '#786982', line: '#b9a2c3', accent: '#854b9e', tint: '#efdef2', hover: '#d5bfde' },
  { id: 'sage', name: 'Forest Sage', mode: 'light', description: 'Quiet herbal green with a grounded forest accent.',
    bg: '#d5ddd4', paper: '#f9fdf8', sidebar: '#97a196', text: '#293a2e', muted: '#637b68', line: '#889387', accent: '#347247', tint: '#d5ead4', hover: '#bcc5bb' },
  { id: 'citrus', name: 'Lemon Leaf', mode: 'light', description: 'Bright lemon cream with a fresh leaf accent.',
    bg: '#e2d6a8', paper: '#fffef5', sidebar: '#d6c789', text: '#3c361f', muted: '#796d45', line: '#c0b37a', accent: '#92720b', tint: '#f5ecc4', hover: '#ddd09c' },
  { id: 'lagoon', name: 'Lagoon Teal', mode: 'light', description: 'Pale aqua with a deep tropical teal accent.',
    bg: '#add6ce', paper: '#f8fffc', sidebar: '#c4e5db', text: '#1d3831', muted: '#57796e', line: '#adcdc3', accent: '#087b69', tint: '#cdeee3', hover: '#b6dcd3' },
  { id: 'clay', name: 'Adobe Rust', mode: 'light', description: 'Soft adobe and a rich rust accent.',
    bg: '#cbc3bf', paper: '#fffaf7', sidebar: '#beafa8', text: '#412c2a', muted: '#80635f', line: '#ad9d96', accent: '#ad463b', tint: '#f3dcd5', hover: '#c6bbb6' },
  { id: 'periwinkle', name: 'Periwinkle Iris', mode: 'light', description: 'Airy blue-violet with an indigo accent.',
    bg: '#e7eaf3', paper: '#fcfdff', sidebar: '#9ba0ac', text: '#29334b', muted: '#66748f', line: '#8b919e', accent: '#4d67b6', tint: '#dce6fa', hover: '#c9ccd7' },
  { id: 'onyx', name: 'Onyx Silver', mode: 'dark', description: 'Near-black stone with a clean silver accent.',
    bg: '#17191c', paper: '#222529', sidebar: '#101215', text: '#eceff1', muted: '#a7afb5', line: '#373c41', accent: '#b9c8d1', tint: '#2c353b', hover: '#2a2e32' },
  { id: 'volcanic', name: 'Basalt Ember', mode: 'dark', description: 'Basalt and cooled ash with a molten orange accent.',
    bg: '#1d1b19', paper: '#292522', sidebar: '#121110', text: '#f3ece4', muted: '#b7a99b', line: '#423a33', accent: '#ff8a3d', tint: '#493020', hover: '#352a23' },
  { id: 'deepsea', name: 'Deepsea Aqua', mode: 'dark', description: 'Abyssal blue with a bright aqua accent.',
    bg: '#101a29', paper: '#19263a', sidebar: '#0a111d', text: '#e5edf7', muted: '#9eafc7', line: '#2d405c', accent: '#51d8c4', tint: '#1b3d48', hover: '#222f43' },
  { id: 'plum', name: 'Plum Lavender', mode: 'dark', description: 'Inky aubergine with a lavender-violet accent.',
    bg: '#1b1728', paper: '#272139', sidebar: '#100e1a', text: '#eeeafa', muted: '#b0a9ca', line: '#3e3857', accent: '#b7a0ff', tint: '#362d54', hover: '#302a45' },
  { id: 'pine', name: 'Pine Fern', mode: 'dark', description: 'Deep alpine green with a fresh fern accent.',
    bg: '#10271a', paper: '#1a3524', sidebar: '#09170f', text: '#e7f1e9', muted: '#a3bea9', line: '#2b4d36', accent: '#a7db78', tint: '#25452b', hover: '#263c2d' },
  { id: 'cobalt', name: 'Cobalt Electric', mode: 'dark', description: 'Midnight indigo with an electric blue accent.',
    bg: '#17152c', paper: '#24203f', sidebar: '#0e0c1d', text: '#f0edff', muted: '#b4add5', line: '#3d3764', accent: '#9c8cff', tint: '#30295b', hover: '#302b4b' },
  { id: 'ruby', name: 'Ruby Rose', mode: 'dark', description: 'Dark garnet with a bright rose accent.',
    bg: '#24171b', paper: '#332126', sidebar: '#180f12', text: '#f3e7e9', muted: '#c0a3aa', line: '#50343d', accent: '#ff91a4', tint: '#4a2833', hover: '#3d272e' },
  { id: 'canyon', name: 'Canyon Ember', mode: 'light', description: 'Sun-baked clay with a burnt orange accent.',
    bg: '#b7afa6', paper: '#fffaf2', sidebar: '#ddcbb4', text: '#3e2b1f', muted: '#7a6451', line: '#c7b59f', accent: '#b0431a', tint: '#f5dccc', hover: '#c6baac' },
  { id: 'meadow', name: 'Spring Meadow', mode: 'light', description: 'Fresh sprout green with a leafy accent.',
    bg: '#d3e2c5', paper: '#fcfff6', sidebar: '#9dba85', text: '#2b3a23', muted: '#66775b', line: '#8da877', accent: '#4a7d2b', tint: '#dcefcf', hover: '#bdd2ab' },
  { id: 'harbor', name: 'Morning Harbor', mode: 'light', description: 'Harbor mist blue with a vivid marine accent.',
    bg: '#adb3b7', paper: '#ffffff', sidebar: '#adbcc6', text: '#223242', muted: '#5e7383', line: '#9aa9b4', accent: '#1a5fb4', tint: '#d9e8fa', hover: '#adb7bd' },
  { id: 'orchid', name: 'Wild Orchid', mode: 'light', description: 'Pale petal pink with a bold magenta accent.',
    bg: '#faf0f6', paper: '#fffcfd', sidebar: '#f1d9e8', text: '#412234', muted: '#7c5e71', line: '#e6c6db', accent: '#b02a7a', tint: '#f5d5e8', hover: '#f4e2ed' },
  { id: 'dune', name: 'Golden Dune', mode: 'light', description: 'Warm dune sand with a deep bronze accent.',
    bg: '#f1ebda', paper: '#fffdf5', sidebar: '#a59c82', text: '#3e331e', muted: '#786a4c', line: '#978d74', accent: '#8c4d0f', tint: '#f0dfbd', hover: '#d3cbb7' },
  { id: 'tidepool', name: 'Tidepool', mode: 'light', description: 'Shallow aqua with a deep sea-green accent.',
    bg: '#afd5d4', paper: '#f8fffd', sidebar: '#77b8b6', text: '#1e3531', muted: '#577672', line: '#6ba6a3', accent: '#0b7a7d', tint: '#c9ece8', hover: '#99c9c8' },
  { id: 'wisteria', name: 'Wisteria Dawn', mode: 'light', description: 'Mist lavender with a vivid indigo accent.',
    bg: '#f3f0fc', paper: '#fdfcff', sidebar: '#dfd5f4', text: '#2d2944', muted: '#686181', line: '#d2c7e8', accent: '#5b4bc4', tint: '#ded5f8', hover: '#e9e3f8' },
  { id: 'cedar', name: 'Cedar Grove', mode: 'light', description: 'Birch paper with a bark-brown accent.',
    bg: '#f2f0e9', paper: '#faf9f5', sidebar: '#dfd8c6', text: '#32302a', muted: '#6e695c', line: '#d6cfbb', accent: '#6b4a2a', tint: '#e8dcc6', hover: '#eae5d6' },
  { id: 'blossom', name: 'Cherry Blossom', mode: 'light', description: 'Soft blossom pink with a true red accent.',
    bg: '#b9b0b0', paper: '#fffbfb', sidebar: '#a89595', text: '#412c2c', muted: '#7e6161', line: '#9a8686', accent: '#be2e3a', tint: '#f6d5d8', hover: '#b2a5a5' },
  { id: 'mint', name: 'Morning Mint', mode: 'light', description: 'Cool mint wash with an emerald accent.',
    bg: '#adb5ae', paper: '#fafffc', sidebar: '#bfd8c5', text: '#23402d', muted: '#5e7c67', line: '#a9c3b0', accent: '#1d7a4d', tint: '#cdecd7', hover: '#b4c3b7' },
  { id: 'nebula', name: 'Deep Nebula', mode: 'dark', description: 'Violet void with a nebula lilac accent.',
    bg: '#595561', paper: '#282037', sidebar: '#24202c', text: '#ebe7f6', muted: '#aca5c3', line: '#403c48', accent: '#c792ea', tint: '#3a2e50', hover: '#44404c' },
  { id: 'crimson', name: 'Crimson Night', mode: 'dark', description: 'Smoked claret with a bright coral-red accent.',
    bg: '#251315', paper: '#362021', sidebar: '#180d0e', text: '#f4e5e5', muted: '#c19f9f', line: '#513235', accent: '#ff7a7a', tint: '#4a2730', hover: '#3d2629' },
  { id: 'kelp', name: 'Midnight Kelp', mode: 'dark', description: 'Deep kelp green with a bright kelp accent.',
    bg: '#3d4944', paper: '#1c3329', sidebar: '#39413e', text: '#e5efe9', muted: '#a1b7ab', line: '#515956', accent: '#4ade80', tint: '#1e4430', hover: '#3b4642' },
  { id: 'saffron', name: 'Saffron Night', mode: 'dark', description: 'Dark spice brown with a golden saffron accent.',
    bg: '#211a11', paper: '#31271f', sidebar: '#16100a', text: '#f2ebdf', muted: '#bbad93', line: '#4c3f2f', accent: '#fbbf24', tint: '#4a3820', hover: '#3d3225' },
  { id: 'trench', name: 'Ocean Trench', mode: 'dark', description: 'Midnight trench blue with a sky-dive accent.',
    bg: '#0d1d2d', paper: '#152b41', sidebar: '#07121f', text: '#e2edf7', muted: '#9bb2c8', line: '#2a3f58', accent: '#38bdf8', tint: '#1b3a52', hover: '#1f2f43' },
  { id: 'moss', name: 'Night Moss', mode: 'dark', description: 'Forest floor dark with a lime-moss accent.',
    bg: '#191f13', paper: '#25301d', sidebar: '#10150b', text: '#ebeddc', muted: '#a8b497', line: '#3a492f', accent: '#bef264', tint: '#2c4224', hover: '#2b3623' },
  { id: 'neon', name: 'Neon Bloom', mode: 'dark', description: 'Black orchid with a neon pink accent.',
    bg: '#2a1a2f', paper: '#321d38', sidebar: '#76527e', text: '#f3e5f4', muted: '#bca2c1', line: '#88678f', accent: '#f0abfc', tint: '#452a51', hover: '#48304f' },
  { id: 'copper', name: 'Smelted Copper', mode: 'dark', description: 'Smoked bronze with a molten copper accent.',
    bg: '#5c5653', paper: '#2f241c', sidebar: '#5e5957', text: '#f1e8de', muted: '#b4a595', line: '#736d6a', accent: '#fb923c', tint: '#4a2e1e', hover: '#5d5755' },
  { id: 'storm', name: 'Thunderstorm', mode: 'dark', description: 'Storm slate with a silver lightning accent.',
    bg: '#141a22', paper: '#1e2531', sidebar: '#0d1118', text: '#e5eaf1', muted: '#9faab8', line: '#323c4b', accent: '#94a3b8', tint: '#2b3543', hover: '#262e3a' },
  { id: 'ultraviolet', name: 'Ultraviolet', mode: 'dark', description: 'Deep ultraviolet with an electric indigo accent.',
    bg: '#353467', paper: '#251e47', sidebar: '#414480', text: '#ebe8fa', muted: '#a9a2cf', line: '#595b91', accent: '#818cf8', tint: '#2c2a5a', hover: '#3a3a71' },
  { id: 'pistachio', name: 'Pistachio Lime', mode: 'light', description: 'Soft pistachio paper with a lively lime accent.',
    bg: '#b3b4aa', paper: '#fcfdf5', sidebar: '#9ea08d', text: '#33351f', muted: '#70734f', line: '#8f917e', accent: '#788d16', tint: '#e7ecc7', hover: '#abac9e' },
  { id: 'mauve', name: 'Mauve Rose', mode: 'light', description: 'Cool lilac paper with a rich berry accent.',
    bg: '#ddbfd5', paper: '#fffcff', sidebar: '#c595b8', text: '#39293a', muted: '#766477', line: '#b186a6', accent: '#963b78', tint: '#efd8eb', hover: '#d3aec9' },
  { id: 'verdant', name: 'Verdant Circuit', mode: 'dark', description: 'Deep evergreen with a bright spring-green accent.',
    bg: '#18281d', paper: '#203126', sidebar: '#3e6d41', text: '#e7f1e9', muted: '#a5b9a8', line: '#567f59', accent: '#80df80', tint: '#29452f', hover: '#27442b' },
  { id: 'fuchsia', name: 'Fuchsia Voltage', mode: 'dark', description: 'Blackberry violet with an electric fuchsia accent.',
    bg: '#211323', paper: '#301b34', sidebar: '#160b18', text: '#f4e6f4', muted: '#bca3bd', line: '#4c3051', accent: '#f078d6', tint: '#442649', hover: '#39243f' },
  { id: 'apricot-ink', name: 'Apricot Ink', mode: 'light', description: 'Apricot paper with an ink accent.',
    bg: '#f7e7d9', paper: '#fbf7f4', sidebar: '#e9bc96', text: '#261e17', muted: '#6f6052', line: '#cca483', accent: '#0931aa', tint: '#e8e7ee', hover: '#f1d6be' },
  { id: 'lemon-verbena', name: 'Lemon Verbena', mode: 'light', description: 'Lemon paper with a verbena accent.',
    bg: '#ebeae5', paper: '#f8f8f7', sidebar: '#c7c6b8', text: '#262517', muted: '#6f6d52', line: '#afaea0', accent: '#09aa67', tint: '#e5f2eb', hover: '#dddcd3' },
  { id: 'peach-ultramarine', name: 'Peach Ultramarine', mode: 'light', description: 'Peach paper with a ultramarine accent.',
    bg: '#fcf5f2', paper: '#fefcfb', sidebar: '#f3d4c8', text: '#261b17', muted: '#6f5a52', line: '#d4b8ad', accent: '#40377b', tint: '#efecf1', hover: '#f8e8e1' },
  { id: 'seafoam-copper', name: 'Seafoam Copper', mode: 'light', description: 'Seafoam paper with a copper accent.',
    bg: '#d9f7f0', paper: '#f4fbf9', sidebar: '#96e9d4', text: '#172622', muted: '#526f68', line: '#83ccb9', accent: '#aa4c09', tint: '#eeede6', hover: '#bef1e5' },
  { id: 'lilac-saffron', name: 'Lilac Saffron', mode: 'light', description: 'Lilac paper with a saffron accent.',
    bg: '#ead9f7', paper: '#f8f4fb', sidebar: '#c596e9', text: '#201726', muted: '#63526f', line: '#ac83cc', accent: '#aa8909', tint: '#f2ebe8', hover: '#dbbef1' },
  { id: 'rosemary-cerise', name: 'Rosemary Cerise', mode: 'light', description: 'Rosemary paper with a cerise accent.',
    bg: '#e1f7d9', paper: '#f6fbf4', sidebar: '#abe996', text: '#1b2617', muted: '#5a6f52', line: '#95cc83', accent: '#aa0959', tint: '#f0e8e8', hover: '#cbf1be' },
  { id: 'icewater-vermilion', name: 'Icewater Vermilion', mode: 'light', description: 'Icewater paper with a vermilion accent.',
    bg: '#e5e9eb', paper: '#f7f8f8', sidebar: '#b8c3c7', text: '#172226', muted: '#52686f', line: '#a0abaf', accent: '#aa1e09', tint: '#f1e7e5', hover: '#d3dadd' },
  { id: 'lavender-pine', name: 'Lavender Pine', mode: 'light', description: 'Lavender paper with a pine accent.',
    bg: '#e5e2ee', paper: '#f7f6f9', sidebar: '#b6add1', text: '#1b1726', muted: '#5a526f', line: '#9f97b7', accent: '#377b5f', tint: '#e8eced', hover: '#d2cde2' },
  { id: 'honey-iris', name: 'Honey Iris', mode: 'light', description: 'Honey paper with an iris accent.',
    bg: '#ebe9e5', paper: '#f8f8f7', sidebar: '#c7c3b8', text: '#262217', muted: '#6f6752', line: '#afaba0', accent: '#6709aa', tint: '#ece5f1', hover: '#dddad3' },
  { id: 'pink-pepper', name: 'Pink Pepper', mode: 'light', description: 'Pink paper with a pepper accent.',
    bg: '#f7d9e3', paper: '#fbf4f6', sidebar: '#e996b1', text: '#26171c', muted: '#6f525c', line: '#cc839b', accent: '#67aa09', tint: '#efeee3', hover: '#f1becf' },
  { id: 'celadon-aubergine', name: 'Celadon Aubergine', mode: 'light', description: 'Celadon paper with an aubergine accent.',
    bg: '#e6faee', paper: '#f8fcfa', sidebar: '#afeec9', text: '#17261d', muted: '#526f5e', line: '#98d0af', accent: '#aa09aa', tint: '#f2e9f4', hover: '#d0f5df' },
  { id: 'buttercup-navy', name: 'Buttercup Navy', mode: 'light', description: 'Buttercup paper with a navy accent.',
    bg: '#f5f7d9', paper: '#fafbf4', sidebar: '#e3e996', text: '#252617', muted: '#6d6f52', line: '#c7cc83', accent: '#0944aa', tint: '#e7ecee', hover: '#eef1be' },
  { id: 'chalk-carmine', name: 'Chalk Carmine', mode: 'light', description: 'Chalk paper with a carmine accent.',
    bg: '#f7d9d9', paper: '#fbf4f4', sidebar: '#e99696', text: '#261717', muted: '#6f5252', line: '#cc8383', accent: '#931f33', tint: '#f3e3e5', hover: '#f1bebe' },
  { id: 'silver-fern', name: 'Silver Fern', mode: 'light', description: 'Silver paper with a fern accent.',
    bg: '#f2f7fc', paper: '#fbfcfe', sidebar: '#c8daf3', text: '#171d26', muted: '#525e6f', line: '#adbed4', accent: '#09aa39', tint: '#e8f5ee', hover: '#e1ebf8' },
  { id: 'linen-peacock', name: 'Linen Peacock', mode: 'light', description: 'Linen paper with a peacock accent.',
    bg: '#f7ebd9', paper: '#fbf8f4', sidebar: '#e9c696', text: '#262017', muted: '#6f6352', line: '#ccad83', accent: '#098faa', tint: '#e8f0ee', hover: '#f1dcbe' },
  { id: 'parchment-plum', name: 'Parchment Plum', mode: 'light', description: 'Parchment paper with a plum accent.',
    bg: '#f7f1d9', paper: '#fbf9f4', sidebar: '#e9d896', text: '#262317', muted: '#6f6a52', line: '#ccbd83', accent: '#7b3770', tint: '#f1e9e9', hover: '#f1e7be' },
  { id: 'opal-persimmon', name: 'Opal Persimmon', mode: 'light', description: 'Opal paper with a persimmon accent.',
    bg: '#f2fcfc', paper: '#fbfefe', sidebar: '#c8f3f3', text: '#172626', muted: '#526f6f', line: '#add4d4', accent: '#7b4e37', tint: '#f1f0ee', hover: '#e1f8f8' },
  { id: 'almond-denim', name: 'Almond Denim', mode: 'light', description: 'Almond paper with a denim accent.',
    bg: '#faf0e6', paper: '#fcfaf8', sidebar: '#eecfaf', text: '#261f17', muted: '#6f6152', line: '#d0b598', accent: '#0959aa', tint: '#e9edf2', hover: '#f5e3d0' },
  { id: 'pearl-burgundy', name: 'Pearl Burgundy', mode: 'light', description: 'Pearl paper with a burgundy accent.',
    bg: '#d9e1f7', paper: '#f4f6fb', sidebar: '#96abe9', text: '#171b26', muted: '#525a6f', line: '#8395cc', accent: '#931f50', tint: '#ece5ed', hover: '#becbf1' },
  { id: 'magnolia-jade', name: 'Magnolia Jade', mode: 'light', description: 'Magnolia paper with a jade accent.',
    bg: '#fcf2f9', paper: '#fefbfd', sidebar: '#f3c8e5', text: '#261721', muted: '#6f5266', line: '#d4adc8', accent: '#377b68', tint: '#eef1f1', hover: '#f8e1f1' },
  { id: 'verbena-raspberry', name: 'Verbena Raspberry', mode: 'light', description: 'Verbena paper with a raspberry accent.',
    bg: '#f9fcf2', paper: '#fdfefb', sidebar: '#e5f3c8', text: '#212617', muted: '#666f52', line: '#c8d4ad', accent: '#7b374e', tint: '#f3eeed', hover: '#f1f8e1' },
  { id: 'sorbet-spruce', name: 'Sorbet Spruce', mode: 'light', description: 'Sorbet paper with a spruce accent.',
    bg: '#f7ddd9', paper: '#fbf5f4', sidebar: '#e9a196', text: '#261917', muted: '#6f5652', line: '#cc8d83', accent: '#377b76', tint: '#ebebea', hover: '#f1c5be' },
  { id: 'cornflower-gold', name: 'Cornflower Gold', mode: 'light', description: 'Cornflower paper with a gold accent.',
    bg: '#e6ebfa', paper: '#f8f9fc', sidebar: '#afc0ee', text: '#171b26', muted: '#525a6f', line: '#98a7d0', accent: '#aa7c09', tint: '#f2efe9', hover: '#d0daf5' },
  { id: 'wheat-kingfisher', name: 'Wheat Kingfisher', mode: 'light', description: 'Wheat paper with a kingfisher accent.',
    bg: '#e9e5dc', paper: '#f8f8f7', sidebar: '#c7c3b8', text: '#262217', muted: '#6f6852', line: '#afaba0', accent: '#0974aa', tint: '#e5edf1', hover: '#dddad3' },
  { id: 'hydrangea-brick', name: 'Hydrangea Brick', mode: 'light', description: 'Hydrangea paper with a brick accent.',
    bg: '#eee6fa', paper: '#faf8fc', sidebar: '#c9afee', text: '#1d1726', muted: '#5e526f', line: '#af98d0', accent: '#aa2909', tint: '#f4e7e9', hover: '#dfd0f5' },
  { id: 'dewdrop-iris', name: 'Dewdrop Iris', mode: 'light', description: 'Dewdrop paper with an iris accent.',
    bg: '#d9f7eb', paper: '#f4fbf8', sidebar: '#96e9c6', text: '#172620', muted: '#526f63', line: '#83ccad', accent: '#54377b', tint: '#e7ebee', hover: '#bef1dc' },
  { id: 'terracotta-lagoon', name: 'Terracotta Lagoon', mode: 'light', description: 'Terracotta paper with a lagoon accent.',
    bg: '#fcf6f2', paper: '#fefcfb', sidebar: '#f3d7c8', text: '#261c17', muted: '#6f5c52', line: '#d4bbad', accent: '#1f8d93', tint: '#ecf3f3', hover: '#f8eae1' },
  { id: 'chamomile-amethyst', name: 'Chamomile Amethyst', mode: 'light', description: 'Chamomile paper with an amethyst accent.',
    bg: '#fcfcf2', paper: '#fefefb', sidebar: '#f2f3c8', text: '#262617', muted: '#6e6f52', line: '#d3d4ad', accent: '#8109aa', tint: '#f4eaf5', hover: '#f8f8e1' },
  { id: 'lotus-indigo', name: 'Lotus Indigo', mode: 'light', description: 'Lotus paper with an indigo accent.',
    bg: '#f7d9e8', paper: '#fbf4f7', sidebar: '#e996bf', text: '#26171f', muted: '#6f5261', line: '#cc83a7', accent: '#090eaa', tint: '#e8e2f1', hover: '#f1bed8' },
  { id: 'silver-sepia', name: 'Silver Sepia', mode: 'light', description: 'Silver paper with a sepia accent.',
    bg: '#e6f3fa', paper: '#f8fbfc', sidebar: '#afd9ee', text: '#172126', muted: '#52666f', line: '#98bdd0', accent: '#aa6709', tint: '#f2efe9', hover: '#d0e9f5' },
  { id: 'milkglass-charcoal', name: 'Milkglass Charcoal', mode: 'light', description: 'Milkglass paper with a charcoal accent.',
    bg: '#d9f7f7', paper: '#f4fbfb', sidebar: '#96e9e9', text: '#172626', muted: '#526f6f', line: '#83cccc', accent: '#1f5093', tint: '#e3edf3', hover: '#bef1f1' },
  { id: 'lime-blossom', name: 'Lime Blossom', mode: 'light', description: 'Lime paper with a blossom accent.',
    bg: '#e8ebe5', paper: '#f7f8f7', sidebar: '#bfc7b8', text: '#1f2617', muted: '#616f52', line: '#a7afa0', accent: '#aa099c', tint: '#f1e5f0', hover: '#d8ddd3' },
  { id: 'cloudberry-azure', name: 'Cloudberry Azure', mode: 'light', description: 'Cloudberry paper with an azure accent.',
    bg: '#f3dddf', paper: '#faf5f5', sidebar: '#dda2a7', text: '#261718', muted: '#6f5255', line: '#c28d92', accent: '#0967aa', tint: '#e7eaef', hover: '#eac5c9' },
  { id: 'obsidian-pearl', name: 'Obsidian Pearl', mode: 'dark', description: 'Obsidian depths with a pearl accent.',
    bg: '#040615', paper: '#0f1129', sidebar: '#03040d', text: '#eff0f5', muted: '#a7a9be', line: '#262730', accent: '#f8d97c', tint: '#2d2b34', hover: '#040512' },
  { id: 'petrol-tangerine', name: 'Petrol Tangerine', mode: 'dark', description: 'Petrol depths with a tangerine accent.',
    bg: '#0c2e37', paper: '#1a3e46', sidebar: '#06191d', text: '#eff4f5', muted: '#a7b9be', line: '#293a3d', accent: '#d4b6a0', tint: '#324e52', hover: '#0a262d' },
  { id: 'aubergine-chartreuse', name: 'Aubergine Chartreuse', mode: 'dark', description: 'Aubergine depths with a chartreuse accent.',
    bg: '#2c0c37', paper: '#3b1a46', sidebar: '#18061d', text: '#f4eff5', muted: '#b8a7be', line: '#39293d', accent: '#cce78d', tint: '#4e354f', hover: '#240a2d' },
  { id: 'navy-rose', name: 'Navy Rose', mode: 'dark', description: 'Navy depths with a rose accent.',
    bg: '#040915', paper: '#0f1629', sidebar: '#03050d', text: '#eff1f5', muted: '#a7adbe', line: '#262830', accent: '#d4a0ad', tint: '#29283a', hover: '#040712' },
  { id: 'mahogany-ice', name: 'Mahogany Ice', mode: 'dark', description: 'Mahogany depths with an ice accent.',
    bg: '#150704', paper: '#29140f', sidebar: '#0d0403', text: '#f5f0ef', muted: '#beaba7', line: '#302726', accent: '#7ce3f8', tint: '#342f2d', hover: '#120604' },
  { id: 'pine-lantern', name: 'Pine Lantern', mode: 'dark', description: 'Pine depths with a lantern accent.',
    bg: '#0c3725', paper: '#1a4634', sidebar: '#061d14', text: '#eff5f3', muted: '#a7beb4', line: '#293d35', accent: '#f8d37c', tint: '#37583d', hover: '#0a2d1e' },
  { id: 'indigo-citron', name: 'Indigo Citron', mode: 'dark', description: 'Indigo depths with a citron accent.',
    bg: '#0f0c37', paper: '#1e1a46', sidebar: '#08061d', text: '#f0eff5', muted: '#a9a7be', line: '#2b293d', accent: '#f4f87c', tint: '#3a374d', hover: '#0c0a2d' },
  { id: 'oxblood-turquoise', name: 'Oxblood Turquoise', mode: 'dark', description: 'Oxblood depths with a turquoise accent.',
    bg: '#370c13', paper: '#461a22', sidebar: '#1d060a', text: '#f5eff0', muted: '#bea7ab', line: '#3d292d', accent: '#7cf8e3', tint: '#4d373b', hover: '#2d0a0f' },
  { id: 'plum-firefly', name: 'Plum Firefly', mode: 'dark', description: 'Plum depths with a firefly accent.',
    bg: '#130712', paper: '#251324', sidebar: '#0b040b', text: '#f5eff5', muted: '#bea7bc', line: '#2e272e', accent: '#aaf87c', tint: '#36312f', hover: '#10060f' },
  { id: 'teal-supernova', name: 'Teal Supernova', mode: 'dark', description: 'Teal depths with a supernova accent.',
    bg: '#0c3735', paper: '#1a4645', sidebar: '#061d1d', text: '#eff5f5', muted: '#a7bebd', line: '#293d3d', accent: '#f87ce3', tint: '#374d5a', hover: '#0a2d2b' },
  { id: 'cacao-periwinkle', name: 'Cacao Periwinkle', mode: 'dark', description: 'Cacao depths with a periwinkle accent.',
    bg: '#37200c', paper: '#462f1a', sidebar: '#1d1106', text: '#f5f2ef', muted: '#beb2a7', line: '#3d3329', accent: '#8d90e7', tint: '#4f3c35', hover: '#2d1a0a' },
  { id: 'basalt-marigold', name: 'Basalt Marigold', mode: 'dark', description: 'Basalt depths with a marigold accent.',
    bg: '#0c2137', paper: '#1a3046', sidebar: '#06121d', text: '#eff2f5', muted: '#a7b3be', line: '#29343d', accent: '#f8dd7c', tint: '#37464d', hover: '#0a1b2d' },
  { id: 'raven-jade', name: 'Raven Jade', mode: 'dark', description: 'Raven depths with a jade accent.',
    bg: '#120826', paper: '#201538', sidebar: '#0a0415', text: '#f1eff5', muted: '#afa7be', line: '#2d2737', accent: '#8de7c3', tint: '#2e304a', hover: '#0f061f' },
  { id: 'bronze-moon', name: 'Bronze Moon', mode: 'dark', description: 'Bronze depths with a moon accent.',
    bg: '#100e09', paper: '#221e17', sidebar: '#0a0806', text: '#f5f3ef', muted: '#beb6a7', line: '#2d2b29', accent: '#8dbde7', tint: '#303332', hover: '#0e0c08' },
  { id: 'cypress-foxglove', name: 'Cypress Foxglove', mode: 'dark', description: 'Cypress depths with a foxglove accent.',
    bg: '#0b2608', paper: '#183815', sidebar: '#061504', text: '#f0f5ef', muted: '#a9bea7', line: '#293727', accent: '#d37cf8', tint: '#304133', hover: '#091f06' },
  { id: 'ink-persimmon', name: 'Ink Persimmon', mode: 'dark', description: 'Ink depths with a persimmon accent.',
    bg: '#0c1137', paper: '#1a2046', sidebar: '#06091d', text: '#eff0f5', muted: '#a7aabe', line: '#292c3d', accent: '#e7a78d', tint: '#35324f', hover: '#0a0e2d' },
  { id: 'port-celadon', name: 'Port Celadon', mode: 'dark', description: 'Port depths with a celadon accent.',
    bg: '#301221', paper: '#402130', sidebar: '#1a0a12', text: '#f5eff2', muted: '#bea7b3', line: '#3b2c34', accent: '#7cf891', tint: '#483d3d', hover: '#270f1b' },
  { id: 'juniper-flame', name: 'Juniper Flame', mode: 'dark', description: 'Juniper depths with a flame accent.',
    bg: '#0c3728', paper: '#1a4638', sidebar: '#061d16', text: '#eff5f3', muted: '#a7beb6', line: '#293d37', accent: '#f8847c', tint: '#374e41', hover: '#0a2d21' },
  { id: 'plum-champagne', name: 'Plum Champagne', mode: 'dark', description: 'Plum depths with a champagne accent.',
    bg: '#1e0c22', paper: '#2e1a33', sidebar: '#110713', text: '#f4eff5', muted: '#baa7be', line: '#332a35', accent: '#d4cca0', tint: '#443141', hover: '#190a1c' },
  { id: 'slate-electric', name: 'Slate Electric', mode: 'dark', description: 'Slate depths with an electric accent.',
    bg: '#040b15', paper: '#0f1a29', sidebar: '#03070d', text: '#eff2f5', muted: '#a7b1be', line: '#262a30', accent: '#cb7cf8', tint: '#272744', hover: '#040912' },
  { id: 'midnight-papaya', name: 'Midnight Papaya', mode: 'dark', description: 'Midnight depths with a papaya accent.',
    bg: '#0b0d0e', paper: '#1a1d1e', sidebar: '#070809', text: '#eff3f5', muted: '#a7b6be', line: '#2a2b2c', accent: '#f8be7c', tint: '#37322a', hover: '#090b0c' },
  { id: 'velvet-glacier', name: 'Velvet Glacier', mode: 'dark', description: 'Velvet depths with a glacier accent.',
    bg: '#370c2c', paper: '#461a3b', sidebar: '#1d0618', text: '#f5eff4', muted: '#bea7b8', line: '#3d2939', accent: '#8dd1e7', tint: '#4f3251', hover: '#2d0a24' },
  { id: 'cinder-azalea', name: 'Cinder Azalea', mode: 'dark', description: 'Cinder depths with an azalea accent.',
    bg: '#150b04', paper: '#291a0f', sidebar: '#0d0703', text: '#f5f2ef', muted: '#beb1a7', line: '#302a26', accent: '#e78dc2', tint: '#422926', hover: '#120904' },
  { id: 'basil-moonstone', name: 'Basil Moonstone', mode: 'dark', description: 'Basil depths with a moonstone accent.',
    bg: '#1e370c', paper: '#2d461a', sidebar: '#101d06', text: '#f2f5ef', muted: '#b1bea7', line: '#323d29', accent: '#a0b3d4', tint: '#3c5432', hover: '#182d0a' },
  { id: 'nocturne-lilac', name: 'Nocturne Lilac', mode: 'dark', description: 'Nocturne depths with a lilac accent.',
    bg: '#122e30', paper: '#213d40', sidebar: '#0a191a', text: '#eff5f5', muted: '#a7bcbe', line: '#2c3a3b', accent: '#ab8de7', tint: '#334756', hover: '#0f2627' },
  { id: 'sable-mint', name: 'Sable Mint', mode: 'dark', description: 'Sable depths with a mint accent.',
    bg: '#37160c', paper: '#46251a', sidebar: '#1d0c06', text: '#f5f1ef', muted: '#beada7', line: '#3d2e29', accent: '#a0d4c5', tint: '#523c30', hover: '#2d120a' },
  { id: 'blackberry-lemon', name: 'Blackberry Lemon', mode: 'dark', description: 'Blackberry depths with a lemon accent.',
    bg: '#17141a', paper: '#262329', sidebar: '#0d0b0e', text: '#f2eff5', muted: '#b3a7be', line: '#2f2d31', accent: '#f8f27c', tint: '#413e34', hover: '#131015' },
  { id: 'abyss-hibiscus', name: 'Abyss Hibiscus', mode: 'dark', description: 'Abyss depths with a hibiscus accent.',
    bg: '#101c30', paper: '#1a3046', sidebar: '#06121d', text: '#eff2f5', muted: '#a7b3be', line: '#29343d', accent: '#f87cb4', tint: '#373a54', hover: '#0a1b2d' },
  { id: 'spruce-apricot', name: 'Spruce Apricot', mode: 'dark', description: 'Spruce depths with an apricot accent.',
    bg: '#04150b', paper: '#0f291a', sidebar: '#030d07', text: '#eff5f2', muted: '#a7beb1', line: '#26302a', accent: '#d4baa0', tint: '#293c2b', hover: '#041209' },
  { id: 'iron-seafoam', name: 'Iron Seafoam', mode: 'dark', description: 'Iron depths with a seafoam accent.',
    bg: '#15141a', paper: '#242329', sidebar: '#0c0b0e', text: '#f0eff5', muted: '#aba7be', line: '#2e2d31', accent: '#7cf8f2', tint: '#2f3f43', hover: '#111015' },
  { id: 'carmine-comet', name: 'Carmine Comet', mode: 'dark', description: 'Carmine depths with a comet accent.',
    bg: '#150406', paper: '#290f11', sidebar: '#0d0304', text: '#f5eff0', muted: '#bea7a9', line: '#302627', accent: '#7c87f8', tint: '#341f2f', hover: '#120405' },
  { id: 'olive-opal', name: 'Olive Opal', mode: 'dark', description: 'Olive depths with an opal accent.',
    bg: '#2c3012', paper: '#3c4021', sidebar: '#181a0a', text: '#f5f5ef', muted: '#bbbea7', line: '#393b2c', accent: '#7ceaf8', tint: '#44563d', hover: '#24270f' },
  { id: 'eclipse-silver', name: 'Eclipse Silver', mode: 'dark', description: 'Eclipse depths with a silver accent.',
    bg: '#370c0c', paper: '#461a1a', sidebar: '#1d0606', text: '#f5efef', muted: '#bea7a7', line: '#3d2929', accent: '#7cbaf8', tint: '#4d2f37', hover: '#2d0a0a' },
];
function palette(definition) {
  const { id, name, mode, description, ...base } = definition;
  const surfaces = [base.bg, base.paper, base.sidebar, base.tint, base.hover];
  const accent = readableColor(base.accent, surfaces);
  const tokens = { ...base, accent,
    muted: readableColor(base.muted, surfaces),
    'accent-contrast': onColor(accent),
    'accent-hover': readableColor(mixColor(accent, mode === 'dark' ? '#ffffff' : '#000000', 0.08), surfaces),
    'border-strong': readableColor(base.muted, [base.paper, base.bg, base.sidebar], 3),
    focus: readableColor(base.accent, surfaces, 3),
    link: accent,
    'code-bg': base.sidebar, 'code-text': base.text,
    overlay: mode === 'dark' ? '#020711bb' : '#15201866',
    'overlay-strong': mode === 'dark' ? '#020711dd' : '#152018bb',
    shadow: mode === 'dark' ? '#00000066' : '#00000033',
    'shadow-soft': mode === 'dark' ? '#00000033' : '#00000014',
  };
  for (const [role, color] of Object.entries({ success: '#22834a', danger: '#be3b36', warning: '#986000', info: '#2865b2' })) {
    const tint = mixColor(base.paper, color, mode === 'dark' ? 0.17 : 0.09);
    tokens[role + '-tint'] = tint;
    tokens[role] = readableColor(color, [...surfaces, tint]);
    tokens[role + '-contrast'] = onColor(tokens[role]);
  }
  return Object.freeze({ id, name, mode, description, tokens: Object.freeze(tokens) });
}
export const palettes = Object.freeze(definitions.map(palette));
// Accent hue drives the appearance panel's within-mode color order, so the
// grid reads as a rainbow rather than registry insertion order.
export function accentHue(value) {
  const hex = String(value).trim().toLowerCase();
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
  const [r, g, b] = channels;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}
export function accentSaturation(value) {
  const channels = String(value).trim().toLowerCase().slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
  const max = Math.max(...channels), min = Math.min(...channels);
  if (max === 0) return 0;
  return (max - min) / max;
}
export const paletteHue = palette => accentHue(palette.tokens.accent);
function comparePalettesByColor(a, b) {
  if (a.mode !== b.mode) return a.mode === 'light' ? -1 : 1;
  const hue = paletteHue(a) - paletteHue(b);
  if (hue !== 0) return hue;
  const saturation = accentSaturation(b.tokens.accent) - accentSaturation(a.tokens.accent);
  if (Math.abs(saturation) > 0.001) return saturation;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
// Light palettes first, then dark; each mode runs red -> orange -> yellow ->
// green -> teal -> blue -> violet -> pink by accent hue.
export const sortedPalettes = Object.freeze([...palettes].sort(comparePalettesByColor));
export const lightPalettes = Object.freeze(sortedPalettes.filter(p => p.mode === 'light'));
export const darkPalettes = Object.freeze(sortedPalettes.filter(p => p.mode === 'dark'));
export const isTheme = value => palettes.some(p => p.id === value);
export const resolveTheme = value => isTheme(value) ? value : 'light';
export const themePalette = value => palettes.find(p => p.id === resolveTheme(value));
export const themeMode = value => themePalette(value).mode;
export const themeColors = Object.freeze(Object.fromEntries(palettes.map(p => [p.id, p.tokens.bg])));
export const paletteStyles = Object.freeze(Object.fromEntries(palettes.map(p => [p.id,
  Object.freeze(Object.fromEntries(Object.entries(p.tokens).map(([key, color]) => ['--' + key, color]))),
])));
export function themeStyle(value) { return paletteStyles[themePalette(value).id]; }
export function applyTheme(value, root = document.documentElement) {
  const p = themePalette(value);
  root.dataset.theme = p.id;
  root.style.backgroundColor = p.tokens.bg;
  root.style.colorScheme = p.mode;
  for (const [key, color] of Object.entries(themeStyle(p.id))) root.style.setProperty(key, color);
}
// Checked-in fallback CSS is generated from exactly these same tokens. It also
// makes Vite development and server-rendered fixtures independent of JavaScript.
export function paletteCSS() {
  return '/* Generated by scripts/palette-css.mjs. Edit domain/theme.mjs, not this file. */\n' + palettes.map(p =>
    `${p.id === 'light' ? ':root, ' : ''}:root[data-theme="${p.id}"] {\n  color-scheme: ${p.mode};\n` +
    Object.entries(themeStyle(p.id)).map(([key, color]) => `  ${key}: ${color};`).join('\n') + '\n}\n').join('\n');
}
