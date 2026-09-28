import { contrast, mixColor, onColor, readableColor } from './color.mjs';

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
  { id: 'peach-ultramarine', name: 'Peach Ultramarine', mode: 'light', description: 'Peach paper with an ultramarine accent.',
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
  { id: 'seashell-ink', name: 'Seashell Ink', mode: 'light', description: 'Shell pink paper with a crisp ink-blue accent.',
    bg: '#ddc0cc', paper: '#fcf9fa', sidebar: '#f0765b', text: '#391923', muted: '#7c3b3d', line: '#cc6284', accent: '#27268b', tint: '#e6e3ee', hover: '#efc2dc' },
  { id: 'oatmeadow-blue', name: 'Oatmeadow Blue', mode: 'light', description: 'Oat fields and meadow green with a clear blue mark.',
    bg: '#ede6db', paper: '#fdfdfc', sidebar: '#bfcc8a', text: '#30351d', muted: '#746b49', line: '#abb267', accent: '#156c7e', tint: '#e0ebec', hover: '#eeeed3' },
  { id: 'frost-berry', name: 'Frost Berry', mode: 'light', description: 'Cool frost surfaces with a preserved berry accent.',
    bg: '#bee8e7', paper: '#f7f9fa', sidebar: '#83e9cf', text: '#1b3e3e', muted: '#455671', line: '#6eaccf', accent: '#84121e', tint: '#ebe1e3', hover: '#99c6ea' },
  { id: 'yuzu-slate', name: 'Yuzu Slate', mode: 'light', description: 'Pale yuzu paper grounded by slate-blue controls.',
    bg: '#f4efe4', paper: '#fafaf7', sidebar: '#afcd7a', text: '#272e16', muted: '#817f56', line: '#cfc581', accent: '#0d2673', tint: '#e2e4ea', hover: '#e0dda3' },
  { id: 'porcelain-moss', name: 'Porcelain Moss', mode: 'light', description: 'Blue porcelain with a quiet moss-green accent.',
    bg: '#d2e8f3', paper: '#f8fafb', sidebar: '#89e1ec', text: '#0d1929', muted: '#53618d', line: '#747db2', accent: '#319f0d', tint: '#e0efde', hover: '#c8d4f4' },
  { id: 'peach-spruce', name: 'Peach Spruce', mode: 'light', description: 'Warm peach wash cut with a spruce accent.',
    bg: '#e7c6b5', paper: '#faf8f7', sidebar: '#ec9d50', text: '#3d3828', muted: '#8b5e51', line: '#c9aba1', accent: '#0a5668', tint: '#e5eaeb', hover: '#dcc7bb' },
  { id: 'misty-denim', name: 'Misty Denim', mode: 'light', description: 'Grey mist and denim blue for a tailored workspace.',
    bg: '#cecff5', paper: '#f6f7fa', sidebar: '#95d1e1', text: '#111231', muted: '#64607f', line: '#92b2d0', accent: '#121e7a', tint: '#dfe1ed', hover: '#c4cdef' },
  { id: 'rose-quartz-teal', name: 'Rose Quartz Teal', mode: 'light', description: 'Mineral pink with a deep teal counterpoint.',
    bg: '#e6c0bb', paper: '#faf7f8', sidebar: '#db8782', text: '#3d2423', muted: '#744743', line: '#af7989', accent: '#1a8d85', tint: '#e3ecec', hover: '#df8ca9' },
  { id: 'butter-mulberry', name: 'Butter Mulberry', mode: 'light', description: 'Buttercream surfaces with a mulberry accent.',
    bg: '#f1dcc2', paper: '#fdfcf9', sidebar: '#d7c29b', text: '#2c271d', muted: '#88774d', line: '#bf9952', accent: '#8f159d', tint: '#f1e3ef', hover: '#dfd098' },
  { id: 'linen-cypress', name: 'Linen Cypress', mode: 'light', description: 'Raw linen and soft bark anchored by cypress.',
    bg: '#f0e4dc', paper: '#fdfcfb', sidebar: '#efed7d', text: '#363520', muted: '#68613f', line: '#cbb450', accent: '#19785a', tint: '#e5eeea', hover: '#d6b293' },
  { id: 'sky-clay', name: 'Sky Clay', mode: 'light', description: 'Open blue air with a sun-fired clay accent.',
    bg: '#d6e6f0', paper: '#fcfcfd', sidebar: '#889dd1', text: '#101924', muted: '#3d8a90', line: '#6cb0ba', accent: '#8e1e2a', tint: '#efe1e3', hover: '#abb9d2' },
  { id: 'violet-olive', name: 'Violet Olive', mode: 'light', description: 'Pale violet shell with a pressed olive accent.',
    bg: '#c9bdde', paper: '#fcfafd', sidebar: '#948df3', text: '#341e42', muted: '#513c65', line: '#a899c3', accent: '#3e9811', tint: '#e5eee1', hover: '#e8c9f4' },
  { id: 'pearl-lagoon', name: 'Pearl Lagoon', mode: 'light', description: 'Pearl white and lagoon blue-green with gentle depth.',
    bg: '#b5f1d2', paper: '#f8fbfa', sidebar: '#46e6cc', text: '#1d492c', muted: '#3d796f', line: '#5bbd90', accent: '#21537d', tint: '#e2eaed', hover: '#a4d3bc' },
  { id: 'thyme-coral', name: 'Thyme Coral', mode: 'light', description: 'Herbal thyme surfaces with a clear coral accent.',
    bg: '#dfe8b6', paper: '#fbfcfa', sidebar: '#58e654', text: '#30411c', muted: '#508351', line: '#bdd17f', accent: '#891925', tint: '#eee2e1', hover: '#d1e6b5' },
  { id: 'alabaster-iris', name: 'Alabaster Iris', mode: 'light', description: 'Clean alabaster with a saturated iris accent.',
    bg: '#e7e6b1', paper: '#fbf8f5', sidebar: '#c9a388', text: '#404014', muted: '#5a5c41', line: '#b5b57f', accent: '#2c1a78', tint: '#e4dfe7', hover: '#ece5be' },
  { id: 'banana-leaf', name: 'Banana Leaf', mode: 'light', description: 'Banana cream and leafy green for a sunny palette.',
    bg: '#dadfc1', paper: '#fbfaf7', sidebar: '#b2ee35', text: '#32321c', muted: '#8a663c', line: '#c7c69d', accent: '#118810', tint: '#e3eedf', hover: '#d4c192' },
  { id: 'blush-navy', name: 'Blush Navy', mode: 'light', description: 'Soft blush with a disciplined navy accent.',
    bg: '#f0a9aa', paper: '#fbf6f6', sidebar: '#de7d54', text: '#301d19', muted: '#743946', line: '#b98a62', accent: '#08218d', tint: '#dcdbe9', hover: '#d2b9a8' },
  { id: 'mineral-rust', name: 'Mineral Rust', mode: 'light', description: 'Cool mineral grey with oxidized rust warmth.',
    bg: '#b2efbb', paper: '#f8fbf9', sidebar: '#2ddf25', text: '#15261e', muted: '#376c4c', line: '#6cbd67', accent: '#7f6921', tint: '#eeefe7', hover: '#afecb8' },
  { id: 'cream-juniper', name: 'Cream Juniper', mode: 'light', description: 'Cream paper and dusky juniper blue-green.',
    bg: '#efe5af', paper: '#f9f8f6', sidebar: '#d47730', text: '#221b14', muted: '#78684a', line: '#dead91', accent: '#208f82', tint: '#e1ece9', hover: '#d6c99c' },
  { id: 'arctic-plum', name: 'Arctic Plum', mode: 'light', description: 'Arctic blue surfaces with a ripe plum accent.',
    bg: '#dbeff3', paper: '#fafbfc', sidebar: '#7feddf', text: '#214343', muted: '#486c82', line: '#88d1d2', accent: '#7b1b5f', tint: '#eadfe9', hover: '#c2d6e2' },
  { id: 'papaya-cobalt', name: 'Papaya Cobalt', mode: 'light', description: 'Papaya-tinted paper with an assertive cobalt accent.',
    bg: '#f6f4ed', paper: '#fbfaf8', sidebar: '#d77f69', text: '#362115', muted: '#645c38', line: '#be9f6c', accent: '#0d0e6f', tint: '#e7e6ec', hover: '#d0c09b' },
  { id: 'heather-bronze', name: 'Heather Bronze', mode: 'light', description: 'Heather lilac haze with a burnished bronze accent.',
    bg: '#d2c1dd', paper: '#fcfbfd', sidebar: '#c184de', text: '#231330', muted: '#6b396a', line: '#a347c5', accent: '#794314', tint: '#ede5e1', hover: '#e4abec' },
  { id: 'celery-garnet', name: 'Celery Garnet', mode: 'light', description: 'Pale celery greens punctuated by garnet.',
    bg: '#f5f7df', paper: '#f9fbf8', sidebar: '#adec92', text: '#244a18', muted: '#5a7a55', line: '#c2db89', accent: '#69080a', tint: '#e9dfdd', hover: '#c5e8ba' },
  { id: 'rainwash-umber', name: 'Rainwash Umber', mode: 'light', description: 'Rain-washed blue grey with a raw umber accent.',
    bg: '#dae3ea', paper: '#fbfcfc', sidebar: '#99c0d1', text: '#1a2e43', muted: '#586e88', line: '#8b97be', accent: '#9d8b0e', tint: '#f3f3e8', hover: '#c2dfe2' },
  { id: 'magnolia-forest', name: 'Magnolia Forest', mode: 'light', description: 'Magnolia warmth with a deep forest accent.',
    bg: '#f2dad4', paper: '#faf8f8', sidebar: '#c17b67', text: '#351512', muted: '#7f775e', line: '#be9c98', accent: '#0b7c3b', tint: '#e5ede7', hover: '#ebdfd3' },
  { id: 'bluebell-ochre', name: 'Bluebell Ochre', mode: 'light', description: 'Bluebell mist paired with earthy ochre.',
    bg: '#bdc5ed', paper: '#f5f6fb', sidebar: '#729cbc', text: '#151c2d', muted: '#47496c', line: '#7367c0', accent: '#834d1f', tint: '#e9e5e4', hover: '#99a6d1' },
  { id: 'cucumber-orchid', name: 'Cucumber Orchid', mode: 'light', description: 'Cool cucumber green with a vivid orchid accent.',
    bg: '#b0f2c3', paper: '#fafdfb', sidebar: '#7ceb86', text: '#1c3f24', muted: '#405e46', line: '#a1c4bb', accent: '#611d7a', tint: '#ece9f0', hover: '#bbe4cd' },
  { id: 'ricepaper-lake', name: 'Ricepaper Lake', mode: 'light', description: 'Quiet ricepaper neutrals with a lake-blue accent.',
    bg: '#dbe1bc', paper: '#fdfdfb', sidebar: '#c0a170', text: '#31330f', muted: '#6a5644', line: '#d8b38f', accent: '#113f79', tint: '#e6eaee', hover: '#ede5ac' },
  { id: 'sunlit-plum', name: 'Sunlit Plum', mode: 'light', description: 'Sunlit cream with a deep preserved-plum accent.',
    bg: '#f9f0e4', paper: '#fbfaf8', sidebar: '#d8db99', text: '#423616', muted: '#7e663f', line: '#d1bb8c', accent: '#51165d', tint: '#e8e0e6', hover: '#cfbaa5' },
  { id: 'seagrass-carmine', name: 'Seagrass Carmine', mode: 'light', description: 'Seagrass green-blue with a carmine signal.',
    bg: '#cef0ea', paper: '#f7f9f9', sidebar: '#5ddd97', text: '#124139', muted: '#488674', line: '#4ec18f', accent: '#7c1737', tint: '#eae1e4', hover: '#c3e2e5' },
  { id: 'nightshade-gold', name: 'Nightshade Gold', mode: 'dark', description: 'Purple-black nightshade with restrained gold.',
    bg: '#0f0715', paper: '#251934', sidebar: '#160e24', text: '#eee5f1', muted: '#c0b4c8', line: '#491d4e', accent: '#eeae85', tint: '#493442', hover: '#3f1b3f' },
  { id: 'deep-petrol-rose', name: 'Deep Petrol Rose', mode: 'dark', description: 'Petrol blue-green depths with a dusty rose accent.',
    bg: '#061e1e', paper: '#104241', sidebar: '#0e211f', text: '#eaf1f2', muted: '#adc2c2', line: '#2a474c', accent: '#e15575', tint: '#33454a', hover: '#142b31' },
  { id: 'charcoal-lime', name: 'Charcoal Lime', mode: 'dark', description: 'Neutral charcoal sharpened with electric lime.',
    bg: '#0d2e3e', paper: '#0f2839', sidebar: '#03080b', text: '#f2f3f6', muted: '#a1a4c9', line: '#283e54', accent: '#8ef56b', tint: '#2b5644', hover: '#1b1f35' },
  { id: 'black-cherry-ice', name: 'Black Cherry Ice', mode: 'dark', description: 'Black cherry shadows with an icy blue accent.',
    bg: '#0e0606', paper: '#4b1a2f', sidebar: '#0b0305', text: '#f2e6e8', muted: '#b093a0', line: '#4d2335', accent: '#4ce9cc', tint: '#4b4b54', hover: '#40162e' },
  { id: 'kelp-lantern', name: 'Kelp Lantern', mode: 'dark', description: 'Kelp forest darks lit by lantern amber.',
    bg: '#0c412b', paper: '#1b463c', sidebar: '#04120e', text: '#e8f5ed', muted: '#afceb8', line: '#235c47', accent: '#de937f', tint: '#415549', hover: '#0f3720' },
  { id: 'ink-azalea', name: 'Ink Azalea', mode: 'dark', description: 'Blue-black ink with a blooming azalea accent.',
    bg: '#091624', paper: '#23294d', sidebar: '#071322', text: '#eceef6', muted: '#a1b3c5', line: '#1e2652', accent: '#ec91a2', tint: '#4f4060', hover: '#1f214d' },
  { id: 'smoke-citrine', name: 'Smoke Citrine', mode: 'dark', description: 'Smoky warm greys with a citrine accent.',
    bg: '#141207', paper: '#4f3818', sidebar: '#292209', text: '#f3ece7', muted: '#c8b49c', line: '#66462a', accent: '#f3c94a', tint: '#6d5221', hover: '#21170a' },
  { id: 'midnight-mint', name: 'Midnight Mint', mode: 'dark', description: 'Blue midnight surfaces with a mint-green accent.',
    bg: '#0c152e', paper: '#162040', sidebar: '#030309', text: '#eaebf3', muted: '#a1a8c4', line: '#2a294f', accent: '#62f277', tint: '#224048', hover: '#141d2d' },
  { id: 'auburn-cyan', name: 'Auburn Cyan', mode: 'dark', description: 'Auburn brown depths with a clear cyan edge.',
    bg: '#362617', paper: '#553318', sidebar: '#100b07', text: '#f6f1ec', muted: '#cea398', line: '#372a22', accent: '#9be7d8', tint: '#604f36', hover: '#594419' },
  { id: 'void-pomegranate', name: 'Void Pomegranate', mode: 'dark', description: 'Nearly black violet with pomegranate glow.',
    bg: '#100712', paper: '#261028', sidebar: '#0f020d', text: '#f3ecf3', muted: '#cb9cc9', line: '#44324e', accent: '#d46d59', tint: '#472231', hover: '#3b1b42' },
  { id: 'fir-periwinkle', name: 'Fir Periwinkle', mode: 'dark', description: 'Fir green depths with a periwinkle accent.',
    bg: '#0f3c1d', paper: '#113c0c', sidebar: '#061507', text: '#e7f1e7', muted: '#abceab', line: '#2b4d2f', accent: '#7e86f5', tint: '#2a4d41', hover: '#234e38' },
  { id: 'iron-amber', name: 'Iron Amber', mode: 'dark', description: 'Cool iron blue-grey with a molten amber accent.',
    bg: '#0a2f3d', paper: '#13285d', sidebar: '#020408', text: '#edf2f7', muted: '#8798c3', line: '#1c4652', accent: '#f0eb91', tint: '#354665', hover: '#14242c' },
  { id: 'port-sage', name: 'Port Sage', mode: 'dark', description: 'Port wine shadow balanced by sage green.',
    bg: '#3e0c26', paper: '#28121a', sidebar: '#19040a', text: '#f7f1f4', muted: '#c789b3', line: '#5c2041', accent: '#84dd5a', tint: '#3b3d27', hover: '#4b1221' },
  { id: 'blueblack-copper', name: 'Blueblack Copper', mode: 'dark', description: 'Blue-black shell with a polished copper accent.',
    bg: '#060624', paper: '#131928', sidebar: '#07111b', text: '#f0f2f6', muted: '#8891c2', line: '#243239', accent: '#ebc53a', tint: '#36352b', hover: '#15205f' },
  { id: 'olive-nebula', name: 'Olive Nebula', mode: 'dark', description: 'Dark olive haze with a nebula violet accent.',
    bg: '#28310a', paper: '#222b0e', sidebar: '#191e0a', text: '#f1f3eb', muted: '#bec2ac', line: '#303e1f', accent: '#b472f4', tint: '#3c3736', hover: '#26350f' },
  { id: 'plum-tide', name: 'Plum Tide', mode: 'dark', description: 'Plum-black surfaces washed with tidepool teal.',
    bg: '#31092b', paper: '#391a31', sidebar: '#0e030c', text: '#f8f0f8', muted: '#c180bb', line: '#3f2d43', accent: '#75e1c8', tint: '#433c4b', hover: '#351737' },
  { id: 'cave-bluebell', name: 'Cave Bluebell', mode: 'dark', description: 'Cave grey-blue with a bluebell accent.',
    bg: '#050a1a', paper: '#19183d', sidebar: '#080a1b', text: '#ebeef5', muted: '#9a9dbd', line: '#2d3946', accent: '#82caf5', tint: '#293359', hover: '#0d1436' },
  { id: 'espresso-raspberry', name: 'Espresso Raspberry', mode: 'dark', description: 'Dark espresso warmth with raspberry brightness.',
    bg: '#2c1907', paper: '#3e2d1b', sidebar: '#100c05', text: '#f9f6f2', muted: '#c9bab3', line: '#564a34', accent: '#eb3cd6', tint: '#592f38', hover: '#391f14' },
  { id: 'abyss-chartreuse', name: 'Abyss Chartreuse', mode: 'dark', description: 'Abyssal blue with a chartreuse signal.',
    bg: '#082327', paper: '#0f232d', sidebar: '#0d1520', text: '#e9edf1', muted: '#afc4cf', line: '#333d56', accent: '#e1cf47', tint: '#3b4732', hover: '#1f2d48' },
  { id: 'mahogany-opal', name: 'Mahogany Opal', mode: 'dark', description: 'Mahogany depths with a luminous opal accent.',
    bg: '#251a0f', paper: '#432d1f', sidebar: '#170404', text: '#f6f0ef', muted: '#c4b7b0', line: '#542f2a', accent: '#51e9ce', tint: '#465645', hover: '#24100a' },
  { id: 'slate-hibiscus', name: 'Slate Hibiscus', mode: 'dark', description: 'Blue slate night with a hibiscus accent.',
    bg: '#070d15', paper: '#12222c', sidebar: '#03121e', text: '#e6edf2', muted: '#9eabbf', line: '#234474', accent: '#e040a0', tint: '#31273e', hover: '#213e4f' },
  { id: 'black-forest-apricot', name: 'Black Forest Apricot', mode: 'dark', description: 'Black forest green warmed by apricot.',
    bg: '#0a1d15', paper: '#264b36', sidebar: '#0a2810', text: '#e5f1e6', muted: '#9dcea2', line: '#2e6329', accent: '#d78168', tint: '#42543e', hover: '#15281d' },
  { id: 'raven-orchid', name: 'Raven Orchid', mode: 'dark', description: 'Raven black with a clear orchid-violet accent.',
    bg: '#1c113a', paper: '#251b41', sidebar: '#070711', text: '#edeaf2', muted: '#ada2bc', line: '#24203e', accent: '#bd44ed', tint: '#482469', hover: '#2b1345' },
  { id: 'cobalt-honey', name: 'Cobalt Honey', mode: 'dark', description: 'Cobalt night with honeyed highlights.',
    bg: '#150b44', paper: '#1d2f53', sidebar: '#05040c', text: '#eeeef8', muted: '#8e95c8', line: '#2b2c44', accent: '#e8e67a', tint: '#42515a', hover: '#1c203c' },
  { id: 'walnut-aqua', name: 'Walnut Aqua', mode: 'dark', description: 'Walnut brown depth with an aqua glass accent.',
    bg: '#381812', paper: '#2b1c16', sidebar: '#1b0e04', text: '#f6f2f0', muted: '#c2a18f', line: '#593f20', accent: '#37e9e4', tint: '#2e4943', hover: '#40371e' },
  { id: 'spruce-fuchsia', name: 'Spruce Fuchsia', mode: 'dark', description: 'Spruce green black with fuchsia voltage.',
    bg: '#052319', paper: '#135740', sidebar: '#0b1717', text: '#e6f3f1', muted: '#a3ccc4', line: '#26585d', accent: '#e68dd8', tint: '#416361', hover: '#112b2e' },
  { id: 'basalt-sunrise', name: 'Basalt Sunrise', mode: 'dark', description: 'Basalt stone lifted by a sunrise orange accent.',
    bg: '#132532', paper: '#0d2f45', sidebar: '#071015', text: '#e4eef3', muted: '#99a9b8', line: '#1e4d58', accent: '#f4c88b', tint: '#405154', hover: '#0f1b3d' },
  { id: 'murex-seafoam', name: 'Murex Seafoam', mode: 'dark', description: 'Murex purple depths with seafoam light.',
    bg: '#190514', paper: '#4c1230', sidebar: '#0e020b', text: '#f7edf5', muted: '#bc90b6', line: '#432333', accent: '#47dcdb', tint: '#4b314a', hover: '#461b2c' },
  { id: 'arctic-night-red', name: 'Arctic Night Red', mode: 'dark', description: 'Cold arctic night with a red navigation mark.',
    bg: '#094246', paper: '#101c26', sidebar: '#040709', text: '#f2f7f9', muted: '#93c7ce', line: '#313c47', accent: '#f23b31', tint: '#372128', hover: '#263b48' },
  { id: 'graphite-celery', name: 'Graphite Celery', mode: 'dark', description: 'Graphite surfaces with a fresh celery accent.',
    bg: '#0e0b1b', paper: '#16173b', sidebar: '#0c1324', text: '#eeeef4', muted: '#8b99c4', line: '#393754', accent: '#8ef353', tint: '#2f4440', hover: '#11133c' },
  { id: 'alder-glow', name: 'Alder Glow', mode: 'light', description: 'Warm birch paper with an embered red accent.',
    bg: '#f6ece1', paper: '#fffaf4', sidebar: '#ecd9c2', text: '#33231a', muted: '#6b5545', line: '#ddc8ae', accent: '#a8321f', tint: '#f6e2d4', hover: '#f0e0cd' },
  { id: 'bay-leaf', name: 'Bay Leaf', mode: 'light', description: 'Deep bay green on pale leaf-paper.',
    bg: '#eef3e6', paper: '#fbfdf7', sidebar: '#d3e2c3', text: '#1f2b1c', muted: '#4f6148', line: '#c2d2b0', accent: '#2f6b2e', tint: '#dfeccf', hover: '#e3ebd6' },
  { id: 'driftwood-rose', name: 'Driftwood Rose', mode: 'light', description: 'Weathered taupe with a wild-rose accent.',
    bg: '#f3ebe8', paper: '#fdf9f7', sidebar: '#e2cfca', text: '#38222a', muted: '#6f505b', line: '#d3b8b1', accent: '#96284b', tint: '#f3dbe2', hover: '#ecded9' },
  { id: 'estuary-blue', name: 'Estuary Blue', mode: 'light', description: 'River-mouth grey-blue with a deep current accent.',
    bg: '#e9eff4', paper: '#fbfdfe', sidebar: '#c9d9e6', text: '#1b2a3a', muted: '#4c6073', line: '#b3c6d6', accent: '#1d5a8a', tint: '#d8e7f4', hover: '#dde7ef' },
  { id: 'fig-grove', name: 'Fig Grove', mode: 'light', description: 'Orchard fig violet with a ripe fig accent.',
    bg: '#f2ecf3', paper: '#fdfbfd', sidebar: '#dccfe0', text: '#2c2133', muted: '#63516e', line: '#c6b3cc', accent: '#6b2a6e', tint: '#e8d9ec', hover: '#e7dde9' },
  { id: 'ginkgo-gold', name: 'Ginkgo Gold', mode: 'light', description: 'Ginkgo-leaf cream with a leaf-green and gold accent.',
    bg: '#f7eed2', paper: '#fefdf4', sidebar: '#e9cf8e', text: '#37300f', muted: '#635a3a', line: '#d5c693', accent: '#47630f', tint: '#f3e7c3', hover: '#f0e2ba' },
  { id: 'heron-grey', name: 'Heron Grey', mode: 'light', description: 'Cool heron grey with a deep petrol accent.',
    bg: '#e8ebee', paper: '#f8f9fa', sidebar: '#c3ccd4', text: '#1c242c', muted: '#4b5764', line: '#a9b4bf', accent: '#0e5a5e', tint: '#d5e8e8', hover: '#d9dfe4' },
  { id: 'juniper-frost', name: 'Juniper Frost', mode: 'light', description: 'Pale frost wash with a deep pine accent.',
    bg: '#eff5f3', paper: '#fafdfc', sidebar: '#c9dcc9', text: '#1a2e26', muted: '#496067', line: '#a4c3b4', accent: '#1f5c38', tint: '#d4e9e2', hover: '#dbe4dc' },
  { id: 'kestrel-rust', name: 'Kestrel Rust', mode: 'light', description: 'Sunlit parchment with a kestrel-rust accent.',
    bg: '#f5eee2', paper: '#fefcf7', sidebar: '#d8c096', text: '#3a2a18', muted: '#5e4e37', line: '#cbb48d', accent: '#7c2d0c', tint: '#f2ddc8', hover: '#e9dcc2' },
  { id: 'lotus-pond', name: 'Lotus Pond', mode: 'light', description: 'Still pond-water green with a deep lotus accent.',
    bg: '#ddece2', paper: '#fbfffc', sidebar: '#9fd0b8', text: '#1d2f24', muted: '#44564f', line: '#8fb89f', accent: '#0b4f46', tint: '#c8e8d8', hover: '#cfdccf' },
  { id: 'marl-clay', name: 'Marl Clay', mode: 'light', description: 'Chalky marl pink with a raspberry-clay accent.',
    bg: '#f6e3de', paper: '#fdf8f6', sidebar: '#e3b3a6', text: '#3a2320', muted: '#5f4745', line: '#d2b3a6', accent: '#8e2440', tint: '#eed3d3', hover: '#ead2c8' },
  { id: 'northsea-glass', name: 'Northsea Glass', mode: 'light', description: 'Cold northern sea-glass with a deep ocean accent.',
    bg: '#d8e4e2', paper: '#f9fcfb', sidebar: '#9dbfbe', text: '#1a2c30', muted: '#3a4d50', line: '#8fb0ae', accent: '#0f4c5c', tint: '#c6e2e2', hover: '#ccd8d6' },
  { id: 'oatmilk-espresso', name: 'Oatmilk Espresso', mode: 'light', description: 'Oatmilk cream with a dark espresso accent.',
    bg: '#f1e9da', paper: '#fdfaf3', sidebar: '#d3b98c', text: '#2e2417', muted: '#594a36', line: '#c6b48f', accent: '#5c3a1e', tint: '#e9dcc4', hover: '#e8d8b8' },
  { id: 'quince-orchard', name: 'Quince Orchard', mode: 'light', description: 'Pressed quince straw with a dark bronze accent.',
    bg: '#f5eecb', paper: '#fefdf4', sidebar: '#dcc47e', text: '#33300f', muted: '#54542e', line: '#c9bd85', accent: '#6d4a12', tint: '#eee4b8', hover: '#ece0b4' },
  { id: 'sedge-marsh', name: 'Sedge Marsh', mode: 'light', description: 'Grey-green sedge with a deep pine accent.',
    bg: '#dde0d2', paper: '#fafcf7', sidebar: '#a3ad8f', text: '#232d1f', muted: '#384132', line: '#939e83', accent: '#1c472a', tint: '#d2e2d2', hover: '#d0d5c2' },
  { id: 'lichen-basalt', name: 'Lichen Basalt', mode: 'dark', description: 'Smoked bark with a pale lichen-green glow.',
    bg: '#221d1a', paper: '#2f2723', sidebar: '#161110', text: '#f3ece4', muted: '#bda797', line: '#4a3a32', accent: '#7fe0b2', tint: '#2c4a3e', hover: '#332922' },
  { id: 'driftwood-noir', name: 'Driftwood Noir', mode: 'dark', description: 'Waterlogged grey-green with a blossom-pink signal.',
    bg: '#1e2622', paper: '#2a352d', sidebar: '#121713', text: '#e9f0e8', muted: '#a9bcab', line: '#37473b', accent: '#ff9db0', tint: '#4e2c38', hover: '#2c3830' },
  { id: 'harbor-flare', name: 'Harbor Flare', mode: 'dark', description: 'Midnight harbor blue sparked with chartreuse.',
    bg: '#141c30', paper: '#1f2947', sidebar: '#0b0f1f', text: '#e9edf8', muted: '#a6b1cc', line: '#33405f', accent: '#c6f24e', tint: '#3a4c22', hover: '#222c46' },
  { id: 'violet-furnace', name: 'Violet Furnace', mode: 'dark', description: 'Violet ink fired with furnace gold.',
    bg: '#141230', paper: '#221d45', sidebar: '#0b0a1e', text: '#efeaf9', muted: '#afa9cc', line: '#3d3660', accent: '#ffc53d', tint: '#4c3d20', hover: '#28224a' },
  { id: 'sage-ember', name: 'Sage Ember', mode: 'dark', description: 'Mid-tone sage grey warmed by ember amber.',
    bg: '#2e3833', paper: '#3c4a43', sidebar: '#1b2320', text: '#ecf2ea', muted: '#aebbb2', line: '#49584f', accent: '#ffb454', tint: '#4e3d24', hover: '#3d4a43' },
  { id: 'kiln-ice', name: 'Kiln Ice', mode: 'dark', description: 'Fired coffee-black cooled by clear ice blue.',
    bg: '#271c14', paper: '#37281d', sidebar: '#170f0a', text: '#f4ece2', muted: '#c0a892', line: '#54402f', accent: '#8fd6ff', tint: '#27465a', hover: '#38291f' },
  { id: 'fern-gilt', name: 'Fern Gilt', mode: 'dark', description: 'Deep fern shade with gilt highlights.',
    bg: '#13251c', paper: '#1e3a28', sidebar: '#0a150e', text: '#e9f2e7', muted: '#a6c2ab', line: '#2c4f38', accent: '#ffd166', tint: '#4d4222', hover: '#22392c' },
  { id: 'claret-sage', name: 'Claret Sage', mode: 'dark', description: 'Claret shadow balanced by cool sage.',
    bg: '#2a1218', paper: '#3b1c24', sidebar: '#1a0a0e', text: '#f4e9ea', muted: '#c4a3a8', line: '#57303a', accent: '#a8e6a3', tint: '#2c4c30', hover: '#3a1a22' },
  { id: 'olive-comet', name: 'Olive Comet', mode: 'dark', description: 'Dark olive haze crossed by a violet comet.',
    bg: '#202417', paper: '#2f3320', sidebar: '#12140b', text: '#f0f1e4', muted: '#b6b898', line: '#40462e', accent: '#b49aff', tint: '#38335c', hover: '#2e3221' },
  { id: 'slate-bloom', name: 'Slate Bloom', mode: 'dark', description: 'Blue slate night with a blooming lilac.',
    bg: '#1a2027', paper: '#263039', sidebar: '#101418', text: '#ebeff3', muted: '#a9b4bd', line: '#39434d', accent: '#f2a7ff', tint: '#4a2f56', hover: '#28333d' },
  { id: 'bronze-petal', name: 'Bronze Petal', mode: 'dark', description: 'Aged bronze-olive with a hot petal pink.',
    bg: '#2b2a20', paper: '#3a382a', sidebar: '#171610', text: '#f2efe4', muted: '#bcb498', line: '#4e4a34', accent: '#ff7eb6', tint: '#50283e', hover: '#3a3729' },
  { id: 'mangrove-flare', name: 'Mangrove Flare', mode: 'dark', description: 'Mangrove darks lit by a lime flare.',
    bg: '#0f2a24', paper: '#1a4038', sidebar: '#071613', text: '#eaf4ee', muted: '#a4beb2', line: '#2c5048', accent: '#d9f99d', tint: '#3a4c26', hover: '#1c3832' },
  { id: 'plum-ingot', name: 'Plum Ingot', mode: 'dark', description: 'Smelted plum darks with a gold ingot accent.',
    bg: '#2b1626', paper: '#3a2135', sidebar: '#170b14', text: '#f3eaf2', muted: '#c2a7bc', line: '#523344', accent: '#ffcf4d', tint: '#4d4222', hover: '#38222f' },
  { id: 'port-ember', name: 'Port Ember', mode: 'dark', description: 'Dark port wine warmed by a peach ember.',
    bg: '#2a1219', paper: '#3a1c26', sidebar: '#180a10', text: '#f2e9ee', muted: '#c2a7b0', line: '#55333e', accent: '#ffb59e', tint: '#4e2f26', hover: '#3c2029' },
  { id: 'seastack-lime', name: 'Seastack Lime', mode: 'dark', description: 'Blue-grey sea stack charged with lime.',
    bg: '#232d38', paper: '#303d4d', sidebar: '#141a21', text: '#e9eff5', muted: '#a9b7c4', line: '#3d4b5c', accent: '#a3e635', tint: '#354a24', hover: '#303c49' },
  { id: 'amber-field', name: 'Amber Field', mode: 'light', description: 'Sun-cured amber with a dark bronze accent.',
    bg: '#eedcae', paper: '#fefbf3', sidebar: '#cda452', text: '#33270b', muted: '#493e24', line: '#b8933f', accent: '#583905', tint: '#f0e0b4', hover: '#e7d6a8' },
  { id: 'citron-grove', name: 'Citron Grove', mode: 'light', description: 'Sharp citron leaf with a dark grove accent.',
    bg: '#f5f8e4', paper: '#fcfdf4', sidebar: '#bccb6e', text: '#2f330f', muted: '#50532e', line: '#a9b45c', accent: '#42530a', tint: '#e9edb8', hover: '#e4e6c2' },
  { id: 'chartreuse-lab', name: 'Chartreuse Lab', mode: 'light', description: 'Electric chartreuse tempered by a lab-dark accent.',
    bg: '#dfe3ba', paper: '#fafbf2', sidebar: '#9aa64e', text: '#2a300c', muted: '#36391f', line: '#878f45', accent: '#2f3b05', tint: '#e6e8b6', hover: '#d6d8ac' },
  { id: 'olive-branch', name: 'Olive Branch', mode: 'light', description: 'Silvered olive leaves with a dark branch accent.',
    bg: '#ececdf', paper: '#fbfbf3', sidebar: '#c2c197', text: '#2c2e0e', muted: '#434627', line: '#abaa7f', accent: '#3f470f', tint: '#e6e6bc', hover: '#e0dec2' },
  { id: 'shamrock-mist', name: 'Shamrock Mist', mode: 'light', description: 'Shamrock green breathing through cool mist.',
    bg: '#d5ead7', paper: '#f8fdf9', sidebar: '#7fc48d', text: '#1e3524', muted: '#394b3c', line: '#6faa7c', accent: '#115131', tint: '#c9e8d2', hover: '#c6d8c9' },
  { id: 'sage-velvet', name: 'Sage Velvet', mode: 'light', description: 'Garden sage with a crushed-velvet plum accent.',
    bg: '#dfe4d6', paper: '#fafbf5', sidebar: '#a9b795', text: '#262b1e', muted: '#444639', line: '#95a281', accent: '#5e2a54', tint: '#e2dce4', hover: '#d3d6c4' },
  { id: 'atoll-ring', name: 'Atoll Ring', mode: 'light', description: 'Pale lagoon ringed by a deep atoll accent.',
    bg: '#d3e6e4', paper: '#f7fcfb', sidebar: '#7fb5b1', text: '#1b3030', muted: '#334342', line: '#6b9d98', accent: '#0a4844', tint: '#bfe3e1', hover: '#c2d2d0' },
  { id: 'tide-chart', name: 'Tide Chart', mode: 'light', description: 'Nautical chart blues with a deep-water accent.',
    bg: '#d5e3ea', paper: '#f8fbfc', sidebar: '#7fa9bd', text: '#1b2c36', muted: '#2e3c44', line: '#6c93a6', accent: '#103d59', tint: '#c2dcea', hover: '#c0d0d8' },
  { id: 'skerry-mist', name: 'Skerry Mist', mode: 'light', description: 'Sea-skerry rocks in cold mist, deep-channeled.',
    bg: '#e9eff3', paper: '#f7f9fa', sidebar: '#b4c9d6', text: '#1d2931', muted: '#3b454d', line: '#9db0bd', accent: '#1a4a6b', tint: '#d2e0ea', hover: '#d6dbe0' },
  { id: 'indigo-dye', name: 'Indigo Dye', mode: 'light', description: 'Fresh indigo dye with a vat-dark accent.',
    bg: '#e2e2f1', paper: '#fafafe', sidebar: '#a2a8da', text: '#22233f', muted: '#3f3e51', line: '#8e93c2', accent: '#2b2f7e', tint: '#d5d5f0', hover: '#d2d2e8' },
  { id: 'heliotrope-haze', name: 'Heliotrope Haze', mode: 'light', description: 'Heliotrope haze with a deep bloom accent.',
    bg: '#e9e4f3', paper: '#faf9fd', sidebar: '#b7a9d8', text: '#2b2340', muted: '#474055', line: '#a294c0', accent: '#4a2f86', tint: '#ddd5f1', hover: '#dcd4e8' },
  { id: 'dragonfruit-fizz', name: 'Dragonfruit Fizz', mode: 'light', description: 'Dragonfruit fizz with a deep rind accent.',
    bg: '#f8e2ea', paper: '#fef8fa', sidebar: '#e59dbd', text: '#3a1f2c', muted: '#583d48', line: '#cf87a7', accent: '#821a4a', tint: '#f0cfdf', hover: '#eed2dc' },
  { id: 'blood-orange-sorbet', name: 'Blood Orange Sorbet', mode: 'light', description: 'Blood-orange sorbet with a scorched-rind accent.',
    bg: '#f9e2d6', paper: '#fef9f5', sidebar: '#e89f8b', text: '#3e2314', muted: '#583f2f', line: '#d18f74', accent: '#7c280c', tint: '#f3d3c2', hover: '#efd2c2' },
  { id: 'chili-chocolate', name: 'Chili Chocolate', mode: 'light', description: 'Dark chili chocolate with a dried-chili accent.',
    bg: '#eadfd8', paper: '#faf7f4', sidebar: '#bfa894', text: '#33231a', muted: '#4c3e31', line: '#a8937f', accent: '#6d2e16', tint: '#e7d5c8', hover: '#ded2c4' },
  { id: 'copper-moss', name: 'Copper Moss', mode: 'light', description: 'Mossy stone struck with a copper accent.',
    bg: '#e2e4cc', paper: '#fafbf4', sidebar: '#a7ab7f', text: '#2e2c14', muted: '#3e3e2d', line: '#92966b', accent: '#4f3a0e', tint: '#e6dcbc', hover: '#d6d3b5' },
  { id: 'iris-bed', name: 'Iris Bed', mode: 'light', description: 'Bearded iris rows with a rhizome-dark accent.',
    bg: '#e8eaf5', paper: '#fafbfe', sidebar: '#b9c2e4', text: '#23263e', muted: '#3f3a4e', line: '#a3abd0', accent: '#2c3a75', tint: '#d8ddf2', hover: '#d5d8e8' },
  { id: 'grape-arbor', name: 'Grape Arbor', mode: 'light', description: 'Grape arbor shade with a crushed-grape accent.',
    bg: '#ece2ee', paper: '#fdf9fd', sidebar: '#c2a9c8', text: '#332032', muted: '#4f404c', line: '#ac93b2', accent: '#5f2560', tint: '#e4d2e8', hover: '#ddd4e0' },
  { id: 'damson-jam', name: 'Damson Jam', mode: 'light', description: 'Damson jam with a dark-stone accent.',
    bg: '#f0e2e6', paper: '#fdf8fa', sidebar: '#cf9fae', text: '#38202b', muted: '#503b43', line: '#b78b9a', accent: '#6e1f45', tint: '#e9d0dc', hover: '#e2d2d8' },
  { id: 'foxglove-lane', name: 'Foxglove Lane', mode: 'light', description: 'Foxglove spires with a throat-spot accent.',
    bg: '#f0d8e9', paper: '#fdf8fc', sidebar: '#d295c5', text: '#352036', muted: '#493946', line: '#b881ab', accent: '#6d1a5e', tint: '#e8cde6', hover: '#dfc7db' },
  { id: 'violet-thicket', name: 'Violet Thicket', mode: 'light', description: 'A shaded violet thicket with a bloom-dark accent.',
    bg: '#e8e2f1', paper: '#faf8fd', sidebar: '#8f77ad', text: '#171221', muted: '#1b1822', line: '#7d6891', accent: '#1f0f3d', tint: '#d9cff0', hover: '#d3cbdf' },
  { id: 'flamingo-parade', name: 'Flamingo Parade', mode: 'light', description: 'Flamingo feathers over a lagoon-deep accent.',
    bg: '#f5d9d4', paper: '#fef9f8', sidebar: '#d98a78', text: '#3c211d', muted: '#46312e', line: '#c07a68', accent: '#073d39', tint: '#cfd9d4', hover: '#e8c9c2' },
  { id: 'bubblegum-alley', name: 'Bubblegum Alley', mode: 'light', description: 'Bubblegum pink with a liquorice-dark accent.',
    bg: '#f7dff0', paper: '#fef8fc', sidebar: '#e09ecb', text: '#371f31', muted: '#563e4f', line: '#c988b3', accent: '#521847', tint: '#eed0e8', hover: '#ecd4e4' },
  { id: 'rosehip-tea', name: 'Rosehip Tea', mode: 'light', description: 'Rosehip tea with a brewed-dark accent.',
    bg: '#f7e9e2', paper: '#fdf9f7', sidebar: '#e2b8a4', text: '#3a2024', muted: '#4d3837', line: '#cda086', accent: '#711f2b', tint: '#f0dcd4', hover: '#e9d8cc' },
  { id: 'paprika-smoke', name: 'Paprika Smoke', mode: 'light', description: 'Smoked paprika over ash-rose with an ember accent.',
    bg: '#e6dbd4', paper: '#faf6f5', sidebar: '#b39484', text: '#33231f', muted: '#402f2c', line: '#9e7f71', accent: '#532617', tint: '#e4d2c8', hover: '#d9cfc6' },
  { id: 'pumpkin-coach', name: 'Pumpkin Coach', mode: 'light', description: 'Pumpkin-coach orange with a midnight-harvest accent.',
    bg: '#f8ead0', paper: '#fefbf4', sidebar: '#e0a45c', text: '#37270e', muted: '#4e412a', line: '#c8924f', accent: '#6c3406', tint: '#f2dcb6', hover: '#eed8b4' },
  { id: 'lighthouse-beam', name: 'Lighthouse Beam', mode: 'light', description: 'Warm lighthouse white with a night-sea accent.',
    bg: '#f4f0e2', paper: '#fefdf6', sidebar: '#cbc4a6', text: '#2c2a15', muted: '#565138', line: '#b5ad8a', accent: '#1e3a6e', tint: '#e3e0cd', hover: '#e8e1cb' },
  { id: 'butter-storm', name: 'Butter Storm', mode: 'light', description: 'Butter yellow under a slate-storm accent.',
    bg: '#f6efcf', paper: '#fefdf5', sidebar: '#e0d189', text: '#33300f', muted: '#5e5b36', line: '#c9ba74', accent: '#3d4e63', tint: '#e2e4e2', hover: '#eae5c2' },
  { id: 'camellia-grove', name: 'Camellia Grove', mode: 'light', description: 'Camellia bloom with a deep leaf-green accent.',
    bg: '#f6e2e0', paper: '#fdf8f6', sidebar: '#df9f98', text: '#3a2220', muted: '#553d3a', line: '#cd8f86', accent: '#244b25', tint: '#e4e4d2', hover: '#e8d2cb' },
  { id: 'after-dinner-mint', name: 'After-Dinner Mint', mode: 'light', description: 'Cool mint with a dark-chocolate accent.',
    bg: '#ddf0e4', paper: '#f9fdfb', sidebar: '#9ed4b6', text: '#1f3129', muted: '#45584f', line: '#8abd9f', accent: '#4a2f23', tint: '#cde8d8', hover: '#ccdcd2' },
  { id: 'kite-festival', name: 'Kite Festival', mode: 'light', description: 'Kite-sky blue with a tangerine accent.',
    bg: '#e0ebf4', paper: '#f8fbfd', sidebar: '#a3c4de', text: '#1c2733', muted: '#45505b', line: '#8dabc6', accent: '#86360c', tint: '#f0e0d2', hover: '#d3dde6' },
  { id: 'inkwell-cream', name: 'Inkwell Cream', mode: 'light', description: 'Fresh cream with a deep inkwell accent.',
    bg: '#f1ecdd', paper: '#fdfbf5', sidebar: '#c6bda2', text: '#29291a', muted: '#4f4e3b', line: '#b0a68a', accent: '#232c4e', tint: '#e0e1e6', hover: '#e3ddc8' },
  { id: 'strawberry-basil', name: 'Strawberry Basil', mode: 'light', description: 'Ripe strawberries with torn-basil accent.',
    bg: '#f7efe4', paper: '#fefbf6', sidebar: '#a9bd7f', text: '#3a2320', muted: '#4e463b', line: '#94a56d', accent: '#8b1a24', tint: '#f0dcd4', hover: '#e7dcc8' },
  { id: 'campfire-ash', name: 'Campfire Ash', mode: 'light', description: 'Cool campfire ash with an ember-gold accent.',
    bg: '#e6e3dc', paper: '#f8f8f5', sidebar: '#b3aea1', text: '#28271f', muted: '#444339', line: '#9d9889', accent: '#5a3c0d', tint: '#d0b58b', hover: '#d8d5c8' },
  { id: 'turmeric-ink', name: 'Turmeric Ink', mode: 'light', description: 'Ground turmeric with a deep ink-teal accent.',
    bg: '#f4e5c2', paper: '#fefbf2', sidebar: '#d6b45c', text: '#33290e', muted: '#514830', line: '#c2a24c', accent: '#17424a', tint: '#dfe4e2', hover: '#e9dbb2' },
  { id: 'pebble-beach', name: 'Pebble Beach', mode: 'light', description: 'Wet pebbles with a kelp-dark accent.',
    bg: '#e3e5e3', paper: '#f8f8f5', sidebar: '#9aa39c', text: '#232629', muted: '#383831', line: '#878d87', accent: '#223c43', tint: '#d8dcd8', hover: '#d2d4d0' },
  { id: 'apricot-storm', name: 'Apricot Storm', mode: 'light', description: 'Apricot flesh under a slate-storm accent.',
    bg: '#f7e0c0', paper: '#fef9f2', sidebar: '#d69c4e', text: '#38240f', muted: '#493a2b', line: '#bd8a45', accent: '#1e3a5c', tint: '#ead9c2', hover: '#e6cba8' },
  { id: 'pencil-shaving', name: 'Pencil Shaving', mode: 'light', description: 'Warm graphite grey with a pencil-lead accent.',
    bg: '#e9e6e0', paper: '#faf9f7', sidebar: '#b8b4a8', text: '#26261e', muted: '#48473f', line: '#a29d8f', accent: '#33373c', tint: '#e2e2e2', hover: '#d8d5cb' },
  { id: 'fern-gully', name: 'Fern Gully', mode: 'light', description: 'A shaded fern gully with a frond-dark accent.',
    bg: '#d8e2cc', paper: '#f8fbf4', sidebar: '#82a06c', text: '#1c2617', muted: '#2b3226', line: '#6f9060', accent: '#173718', tint: '#ccd8ba', hover: '#c8d0b6' },
  { id: 'lavender-honey', name: 'Lavender Honey', mode: 'light', description: 'Lavender rows with a honey-dark accent.',
    bg: '#e8e4f0', paper: '#faf8fd', sidebar: '#c0b3d4', text: '#2b2340', muted: '#4d465d', line: '#aa9cc2', accent: '#64430d', tint: '#efe3c2', hover: '#dcd4e6' },
  { id: 'cactus-flower', name: 'Cactus Flower', mode: 'light', description: 'Desert cactus with a bold flower accent.',
    bg: '#dfe6d2', paper: '#fafbf5', sidebar: '#9fb483', text: '#26301c', muted: '#3b4431', line: '#8da172', accent: '#7b1946', tint: '#e8d8de', hover: '#d2d6be' },
  { id: 'mimosa-morning', name: 'Mimosa Morning', mode: 'light', description: 'Pale mimosa with a toasted-peel accent.',
    bg: '#fbf3dc', paper: '#fffdf5', sidebar: '#ecd090', text: '#38300f', muted: '#635b36', line: '#d6bd76', accent: '#894c08', tint: '#f2e6ba', hover: '#efe2ba' },
  { id: 'seal-pup', name: 'Seal Pup', mode: 'light', description: 'Soft seal-grey with a deep harbour accent.',
    bg: '#e0ded8', paper: '#f7f7f4', sidebar: '#8b8b84', text: '#1a1d21', muted: '#222526', line: '#77776f', accent: '#1a2535', tint: '#d4d9de', hover: '#c9cac3' },
  { id: 'sloe-gin', name: 'Sloe Gin', mode: 'light', description: 'Sloe berries with a gin-dark violet accent.',
    bg: '#e4dfe8', paper: '#faf8fb', sidebar: '#9c8fa8', text: '#282230', muted: '#302b34', line: '#887c92', accent: '#3c1e4e', tint: '#d8d2e6', hover: '#d0c9d8' },
  { id: 'rhubarb-crumble', name: 'Rhubarb Crumble', mode: 'light', description: 'Pink rhubarb with a crumble-brown accent.',
    bg: '#f5e0e4', paper: '#fdf8f9', sidebar: '#df9fb4', text: '#3a1f28', muted: '#583d44', line: '#c9889f', accent: '#544119', tint: '#ecdfd2', hover: '#e9d2d8' },
  { id: 'golden-hour', name: 'Golden Hour', mode: 'light', description: 'Low golden sun with a plum-shadow accent.',
    bg: '#f6e8cc', paper: '#fefbf3', sidebar: '#e3bd72', text: '#3a2c14', muted: '#5c4e35', line: '#d0aa60', accent: '#6e2a4e', tint: '#f0dfc0', hover: '#ecdfba' },
  { id: 'cocoa-amber', name: 'Cocoa Amber', mode: 'dark', description: 'Roasted cocoa darks with a warm amber coin.',
    bg: '#33231c', paper: '#41302a', sidebar: '#211410', text: '#f6ece6', muted: '#c2a893', line: '#574135', accent: '#ffb03a', tint: '#4e3d22', hover: '#40302a' },
  { id: 'moss-gilt', name: 'Moss Gilt', mode: 'dark', description: 'Mid-tone moss grey with gilt edging.',
    bg: '#2f3b33', paper: '#3e4c41', sidebar: '#1c2520', text: '#edf2e9', muted: '#abb8a9', line: '#4a5a4c', accent: '#ffce54', tint: '#4e4423', hover: '#3b4940' },
  { id: 'slate-salmon', name: 'Slate Salmon', mode: 'dark', description: 'Blue-grey slate with a salmon flash.',
    bg: '#3a3f4a', paper: '#4a505c', sidebar: '#23262e', text: '#eceef4', muted: '#adb3c0', line: '#545a68', accent: '#ff8a7a', tint: '#52332f', hover: '#484e59' },
  { id: 'mauve-seafoam', name: 'Mauve Seafoam', mode: 'dark', description: 'Dusty mauve depths with seafoam light.',
    bg: '#3d2f3d', paper: '#4e3d4e', sidebar: '#261c26', text: '#f3eaf2', muted: '#c2a9c0', line: '#594759', accent: '#7df0d4', tint: '#2a4d44', hover: '#4b3b4b' },
  { id: 'khaki-cornflower', name: 'Khaki Cornflower', mode: 'dark', description: 'Dark khaki olive with a cornflower opening.',
    bg: '#413c28', paper: '#524c34', sidebar: '#29251a', text: '#f2eee1', muted: '#bfb493', line: '#5b5340', accent: '#8fb8ff', tint: '#2c3f60', hover: '#4f4a33' },
  { id: 'steel-signal', name: 'Steel Signal', mode: 'dark', description: 'Cold steel blue-black with a signal-red mark.',
    bg: '#1f2a33', paper: '#2b3944', sidebar: '#121a20', text: '#e9eff4', muted: '#a7b4bd', line: '#39474f', accent: '#ff5d5d', tint: '#52282c', hover: '#29363f' },
  { id: 'eggplant-leaf', name: 'Eggplant Leaf', mode: 'dark', description: 'Eggplant darks with a fresh leaf accent.',
    bg: '#2b2135', paper: '#3a2d47', sidebar: '#181221', text: '#efebf5', muted: '#b3a9c4', line: '#4c3d5c', accent: '#a4f06a', tint: '#3a5227', hover: '#372b44' },
  { id: 'jungle-tangerine', name: 'Jungle Tangerine', mode: 'dark', description: 'Deep jungle green with tangerine peel.',
    bg: '#0f2e2b', paper: '#1a4039', sidebar: '#071b19', text: '#e9f4ee', muted: '#a4beb2', line: '#2c5048', accent: '#ff9e57', tint: '#4c3a22', hover: '#1c3a35' },
  { id: 'brick-gold', name: 'Brick Gold', mode: 'dark', description: 'Kiln-fired brick with a gold ingot glow.',
    bg: '#431b16', paper: '#562820', sidebar: '#28100c', text: '#f4e9ec', muted: '#c9a49b', line: '#61342c', accent: '#ffc44d', tint: '#4c3a1e', hover: '#512720' },
  { id: 'blackgreen-lilac', name: 'Blackgreen Lilac', mode: 'dark', description: 'Black-green shade breathing pale lilac.',
    bg: '#182b1a', paper: '#233c25', sidebar: '#0d1a0f', text: '#e9f2e8', muted: '#a6c2ab', line: '#2e5233', accent: '#e8b4ff', tint: '#44335c', hover: '#243a27' },
  { id: 'teal-lemon', name: 'Teal Lemon', mode: 'dark', description: 'Deep teal water with a lemon slice.',
    bg: '#14302e', paper: '#1f443f', sidebar: '#0a1c1a', text: '#eaf4ee', muted: '#a5bdb8', line: '#2c524c', accent: '#ffe14d', tint: '#4c4a22', hover: '#223d3a' },
  { id: 'slate-apricot', name: 'Slate Apricot', mode: 'dark', description: 'Evening slate warmed by dried apricot.',
    bg: '#232c3a', paper: '#303a4c', sidebar: '#141922', text: '#eaeef5', muted: '#a9b4c4', line: '#3d485e', accent: '#ffa07a', tint: '#4c3626', hover: '#2f3849' },
  { id: 'bronze-sky', name: 'Bronze Sky', mode: 'dark', description: 'Dark bronze olive under a clear sky accent.',
    bg: '#36301e', paper: '#474028', sidebar: '#221e12', text: '#f3efe2', muted: '#bdb08e', line: '#544c30', accent: '#6ec6ff', tint: '#27455a', hover: '#443d27' },
  { id: 'cobalt-ember', name: 'Cobalt Ember', mode: 'dark', description: 'Cobalt night with a live ember accent.',
    bg: '#1c2b4a', paper: '#29395e', sidebar: '#10182c', text: '#e9edf8', muted: '#a6aec6', line: '#38486a', accent: '#ff7a45', tint: '#4c3222', hover: '#283754' },
  { id: 'brick-jade', name: 'Brick Jade', mode: 'dark', description: 'Dark brick red cooled by carved jade.',
    bg: '#40201f', paper: '#522d2b', sidebar: '#281210', text: '#f5eae8', muted: '#c6a49e', line: '#5e3634', accent: '#7cf2a5', tint: '#2a4c36', hover: '#4e2b29' },
  { id: 'graphite-cream', name: 'Graphite Cream', mode: 'dark', description: 'Soft graphite lifted by a cream sidebar.',
    bg: '#26262b', paper: '#343439', sidebar: '#33333a', text: '#eef0f2', muted: '#abadb3', line: '#43434a', accent: '#ffe08a', tint: '#4c4426', hover: '#313137' },
  { id: 'abyss-crimson', name: 'Abyss Crimson', mode: 'dark', description: 'Abyssal teal-black with a crimson pop.',
    bg: '#101d1c', paper: '#1b2d2b', sidebar: '#050d0c', text: '#e9f2f0', muted: '#a3b8b4', line: '#2a4040', accent: '#f9627d', tint: '#4c2733', hover: '#1b2928' },
  { id: 'grape-mint', name: 'Grape Mint', mode: 'dark', description: 'Crushed grape darks with cool mint.',
    bg: '#2a2438', paper: '#39324b', sidebar: '#171222', text: '#eeebf6', muted: '#b0a9c6', line: '#473f5e', accent: '#63e6be', tint: '#26493f', hover: '#363049' },
  { id: 'stone-watermelon', name: 'Stone Watermelon', mode: 'dark', description: 'Warm worked stone with watermelon flesh.',
    bg: '#38322b', paper: '#494236', sidebar: '#242016', text: '#f2ede3', muted: '#bdb29e', line: '#564c3c', accent: '#ff677b', tint: '#4e2a33', hover: '#464034' },
  { id: 'petrol-iris', name: 'Petrol Iris', mode: 'dark', description: 'Petrol blue depths with an iris-violet flare.',
    bg: '#0e2a3a', paper: '#1a3a4c', sidebar: '#06141d', text: '#e8f0f5', muted: '#a3b6c2', line: '#2c4a5c', accent: '#a98dff', tint: '#342b52', hover: '#1a3547' },
  { id: 'orchid-frost', name: 'Orchid Frost', mode: 'dark', description: 'Dark orchid woods under a frost-blue accent.',
    bg: '#331e3a', paper: '#452b4d', sidebar: '#1d1022', text: '#f1eaf5', muted: '#bda9c8', line: '#57405f', accent: '#7cc4ff', tint: '#2c4a60', hover: '#422a4b' },
  { id: 'olive-sakura', name: 'Olive Sakura', mode: 'dark', description: 'Dark olive grove with a sakura accent.',
    bg: '#31331d', paper: '#414428', sidebar: '#1c1e0e', text: '#ebf2e8', muted: '#b3b798', line: '#4c4e2e', accent: '#ffa9c6', tint: '#4e2c3c', hover: '#3e4026' },
  { id: 'cognac-cyan', name: 'Cognac Cyan', mode: 'dark', description: 'Dark cognac amber cut with electric cyan.',
    bg: '#3c2a1e', paper: '#4e3828', sidebar: '#271a10', text: '#f4ece1', muted: '#c2ab93', line: '#5e4634', accent: '#4de3ff', tint: '#24495a', hover: '#4b3726' },
  { id: 'plum-marigold', name: 'Plum Marigold', mode: 'dark', description: 'Smoked plum darks with a marigold torch.',
    bg: '#262033', paper: '#352d46', sidebar: '#141021', text: '#e9edf6', muted: '#a9a5c2', line: '#423a5a', accent: '#f0a13c', tint: '#4c3d1e', hover: '#332c44' },
  { id: 'graphite-orchid', name: 'Graphite Orchid', mode: 'dark', description: 'Neutral graphite with a vivid orchid signal.',
    bg: '#2d3336', paper: '#3c4347', sidebar: '#1a1f21', text: '#eceff1', muted: '#abb2b5', line: '#484f53', accent: '#e879f9', tint: '#442c50', hover: '#394046' },
  { id: 'wine-foam', name: 'Wine Foam', mode: 'dark', description: 'Dark wine cellar with pale sea-foam.',
    bg: '#3b1f2b', paper: '#4e2c3a', sidebar: '#250f1a', text: '#f4e9ef', muted: '#c2a5b2', line: '#5a3644', accent: '#99f6e4', tint: '#2a4c46', hover: '#4b2a37' },
  { id: 'forest-coral', name: 'Forest Coral', mode: 'dark', description: 'Deep forest floor with a coral bloom.',
    bg: '#0f2b1d', paper: '#1b3d2a', sidebar: '#07170e', text: '#e9f3eb', muted: '#a4bcae', line: '#2b5240', accent: '#ff7070', tint: '#4c2a30', hover: '#1a3826' },
  { id: 'olive-lavender', name: 'Olive Lavender', mode: 'dark', description: 'Hazy olive darks with a lavender field accent.',
    bg: '#2c2f22', paper: '#3b3f2e', sidebar: '#1a1c13', text: '#eff0e2', muted: '#b2b49b', line: '#484b34', accent: '#c4b5fd', tint: '#3a3560', hover: '#393d2b' },
  { id: 'lagoon-blush', name: 'Lagoon Blush', mode: 'dark', description: 'Night lagoon with a soft blush accent.',
    bg: '#10293a', paper: '#1d394c', sidebar: '#071522', text: '#e8f0f3', muted: '#a4b7c2', line: '#2c495e', accent: '#fda4af', tint: '#4c2f3c', hover: '#1c3649' },
  { id: 'pine-sky', name: 'Pine Sky', mode: 'dark', description: 'Pine-needle darks under an open sky accent.',
    bg: '#1d2f24', paper: '#2a4032', sidebar: '#101c14', text: '#f3eddf', muted: '#a9bcae', line: '#2e5240', accent: '#7dd3fc', tint: '#27485a', hover: '#2a3d30' },
  { id: 'umber-petal', name: 'Umber Petal', mode: 'dark', description: 'Near-black umber with a powder-petal accent.',
    bg: '#1a1210', paper: '#281d1a', sidebar: '#0e0806', text: '#f3ebe6', muted: '#bfa89e', line: '#3e2f2a', accent: '#ffb3c1', tint: '#4c2b34', hover: '#261b18' },
  { id: 'slate-mint', name: 'Slate Mint', mode: 'dark', description: 'Slate night with a lifted mint sidebar.',
    bg: '#232838', paper: '#30364a', sidebar: '#2e3547', text: '#e9edf6', muted: '#a6aec4', line: '#3e4560', accent: '#7ef29d', tint: '#2a4c38', hover: '#2f3547' },
  { id: 'abyss-tangerine', name: 'Abyss Tangerine', mode: 'dark', description: 'Cold abyss water with tangerine rind.',
    bg: '#0d1f26', paper: '#182f37', sidebar: '#050f14', text: '#e8f1f2', muted: '#a3b7bd', line: '#2b424c', accent: '#ffa15c', tint: '#4c3a22', hover: '#1a2c33' },
  { id: 'bordeaux-ice', name: 'Bordeaux Ice', mode: 'dark', description: 'Bordeaux shadow cleared by ice blue.',
    bg: '#341420', paper: '#46202e', sidebar: '#200a10', text: '#f4e9ee', muted: '#c2a5b0', line: '#58323f', accent: '#8ce8ff', tint: '#27455a', hover: '#43202c' },
  { id: 'olive-ember', name: 'Olive Ember', mode: 'dark', description: 'Dark olive night with an ember-orange accent.',
    bg: '#25311c', paper: '#334226', sidebar: '#151c0e', text: '#edf2e6', muted: '#adb59b', line: '#424e2e', accent: '#ff8a66', tint: '#4c3226', hover: '#303f24' },
  { id: 'lagoon-aqua', name: 'Lagoon Aqua', mode: 'dark', description: 'Still lagoon darks with a bright aqua lane.',
    bg: '#0e3232', paper: '#1a4443', sidebar: '#061e1e', text: '#eaf4f2', muted: '#a4bdb9', line: '#2b5150', accent: '#5df2c8', tint: '#23493f', hover: '#1a3f3e' },
  { id: 'bark-gold', name: 'Bark Gold', mode: 'dark', description: 'Dark tree bark with a gold-leaf accent.',
    bg: '#3e2f22', paper: '#503e2c', sidebar: '#2a1e14', text: '#f3ebe2', muted: '#c0ab93', line: '#5c4a36', accent: '#ffc15c', tint: '#4c3f1e', hover: '#4d3c2a' },
  { id: 'emerald-lime', name: 'Emerald Lime', mode: 'dark', description: 'Emerald depths with a lime-zest accent.',
    bg: '#12332a', paper: '#1e463b', sidebar: '#081e17', text: '#eaf3ea', muted: '#a5bcae', line: '#2c5546', accent: '#c9f24b', tint: '#3c4c22', hover: '#1f4034' },
  { id: 'grape-marigold', name: 'Grape Marigold', mode: 'dark', description: 'Dark grape arbour with a marigold lantern.',
    bg: '#2e1b3e', paper: '#3f2851', sidebar: '#1a0f26', text: '#f0eaf6', muted: '#b5a5c8', line: '#553d68', accent: '#ffb347', tint: '#4c3a1e', hover: '#3c2650' },
  { id: 'sienna-lime', name: 'Sienna Lime', mode: 'dark', description: 'Burnt sienna darks with a lime spark.',
    bg: '#3a1c14', paper: '#4c2a1e', sidebar: '#251009', text: '#f5ece1', muted: '#c4a894', line: '#5e3a2a', accent: '#d4f75a', tint: '#424c22', hover: '#492a1e' },
  { id: 'reef-papaya', name: 'Reef Papaya', mode: 'dark', description: 'Deep reef teal with papaya flesh.',
    bg: '#1f3a3a', paper: '#2c4c4b', sidebar: '#122424', text: '#e9f2f1', muted: '#a5bcbb', line: '#334f4e', accent: '#ff9d6b', tint: '#4c3826', hover: '#2b4746' },
  { id: 'indigo-punch', name: 'Indigo Punch', mode: 'dark', description: 'Indigo night with a fruit-punch accent.',
    bg: '#2b2f4e', paper: '#3a3e63', sidebar: '#1a1d33', text: '#ebecf7', muted: '#a8aac8', line: '#454a6e', accent: '#f7678f', tint: '#4c2a3c', hover: '#383c60' },
  { id: 'holly-wisteria', name: 'Holly Wisteria', mode: 'dark', description: 'Holly-leaf darks lit by wisteria violet.',
    bg: '#1a3826', paper: '#264a33', sidebar: '#0e2115', text: '#e9f3e9', muted: '#a9bcae', line: '#2e5440', accent: '#b8a0ff', tint: '#38335b', hover: '#24462f' },
  { id: 'fig-rose', name: 'Fig Rose', mode: 'dark', description: 'Ripe fig darks with a rosewater accent.',
    bg: '#38222e', paper: '#4a2f3d', sidebar: '#241320', text: '#f3e9ef', muted: '#c2a5b4', line: '#573747', accent: '#ff7d9c', tint: '#4e2a38', hover: '#472c3a' },
  { id: 'pitch-vermilion', name: 'Pitch Vermilion', mode: 'dark', description: 'Pitch black lifted by a vermilion sidebar.',
    bg: '#0c0f16', paper: '#181c26', sidebar: '#1a2130', text: '#edeff4', muted: '#a6adbc', line: '#2b313e', accent: '#ff5c39', tint: '#4c2a24', hover: '#181d28' },
];
// A distinct descriptive word for each palette, in catalog order. Reuse a
// color phrase's final word when it is unique; otherwise its compound form
// keeps the color story while making every displayed name exactly two words.
const epithets = `Verdure Silvan Sirocco Cerulean Seabreeze Luminance Firelight Canopy Rime Rouge
Sencha Solstice Cinderspark Velour Boreal Roast White Petals Herbal Cream Tropical Adobe
Airy Clean Cooled Aqua Inky Alpine Midnight Garnet Baked Sprout Marine Magenta Dune
Shallow Vivid Birch Scarlet Emerald Void Coral Green Spice Trench Moss Neon Molten
Lightning Electric Pistachio Bramble Spring Fuchsia Apricot Lemon Ultramarine Copper Saffron
Rosemary Icewater Pine Honey Pepper Aubergine Buttercup Chalk Fern Peacock Parchment Opal
Almond Burgundy Magnolia Verbena Sorbet Cornflower Wheat Hydrangea Dewdrop Terracotta
Chamomile Lotus Sepia Milkglass Blossom Cloudberry Obsidian Petrol Chartreuse Navy Mahogany
Lantern Citron Oxblood Firefly Supernova Cacao Basalt Jade Moon Cypress Persimmon Celadon
Flame Champagne Ionized Papaya Glacier Cinder Moonstone Nocturne Sable Blackberry Hibiscus
Spruce Seafoam Comet Olive Eclipse Crisp Pastoral Preserved Yuzu Porcelain Peach Tailored
Mineral Mulberry Barkcloth Skylit Shell Gentle Thyme Alabaster Banana Disciplined Oxidized
Dusky Arctic Assertive Heather Glinting Rain Warmth Earthen Cucumber Ricepaper Sunlit
Seagrass Nightshade Dusty Sharpened Cherry Kelp Azalea Smoky Mint Auburn Pomegranate
Periwinkle Iron Balanced Polished Nebula Estuarine Cave Brightness Abyssal Luminous Slate
Toasted Raven Honeyed Walnut Voltage Sunrise Murex Navigation Celery Embered Leaf Weathered
River Orchard Ginkgo Heron Frost Kestrel Pond Chalky Northern Oatmilk Quince Sedge
Lichen Waterlogged Sparked Furnace Dusklit Coffee Gilt Claret Meteoric Blooming Aged Mangrove
Smelted Port Stack Cured Zesty Tempered Silvered Shamrock Garden Ringed Nautical Skerry
Indigo Heliotrope Dragonfruit Blood Chili Mossy Bearded Arbor Damson Spires Thicket
Flamingo Bubblegum Rosehip Paprika Pumpkin Lighthouse Butter Camellia Chocolate Kite
Inkwell Strawberries Campfire Spiced Pebbles Flesh Pencil Gully Rows Desert Mimosa
Seal Sloe Rhubarb Golden Roasted Edging Salmon Mauve Khaki Steel Eggplant Jungle
Kiln Mosslight Slice Evening Bronze Incandescent Carved Lifted Crimson Crushed Worked Flare
Woods Sakura Cognac Torch Chromatic Cellar Undergrowth Hazy Blush Needle Powder Moonlit
Abyss Bordeaux Ember Lane Woodland Zest Arbour Sienna Reef Fruit Holly Rosewater Pitch`.trim().split(/\s+/);
if (epithets.length !== definitions.length) throw Error('Every palette needs one distinct name epithet.');
const lastWords = definitions.map(definition => definition.name.split(' ').at(-1));
const lastWordCounts = new Map();
for (const word of lastWords) {
  const key = word.toLowerCase();
  lastWordCounts.set(key, (lastWordCounts.get(key) ?? 0) + 1);
}
const epithetWords = new Set(epithets.map(word => word.toLowerCase()));
const paletteNames = definitions.map((definition, index) =>
  `${epithets[index]} ${lastWordCounts.get(lastWords[index].toLowerCase()) === 1 && !epithetWords.has(lastWords[index].toLowerCase())
    ? lastWords[index] : definition.name.replace(/[^a-zA-Z]+(.)?/g, (_, initial) => initial?.toUpperCase() ?? '')}`);
if (new Set(paletteNames.flatMap(name => name.toLowerCase().split(' '))).size !== definitions.length * 2)
  throw Error('Palette name words must be unique across the catalog.');
function visibleStateColor(base, background, foreground, minimum = 1.12) {
  if (contrast(base, background) >= minimum) return base;
  const source = base.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  let best = null, bestDistance = Infinity;
  for (const endpoint of ['#000000', '#ffffff']) {
    const target = endpoint.slice(1).match(/../g).map(channel => parseInt(channel, 16));
    for (let step = 1; step <= 255; step++) {
      const channels = source.map((channel, index) => Math.round(channel + (target[index] - channel) * step / 255));
      const candidate = '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
      if (contrast(candidate, background) < minimum || contrast(candidate, foreground) < 4.5) continue;
      const distance = channels.reduce((sum, channel, index) => sum + (channel - source[index]) ** 2, 0);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
      break;
    }
  }
  return best ?? base;
}
function distinctMutedColor(base, surfaces, text, minimum = 1.5) {
  const readable = readableColor(base, surfaces);
  if (contrast(readable, text) >= minimum) return readable;
  for (let step = 1; step <= 255; step++) {
    for (const endpoint of ['#000000', '#ffffff']) {
      const candidate = mixColor(readable, endpoint, step / 255);
      if (contrast(candidate, text) >= minimum && surfaces.every(surface => contrast(candidate, surface) >= 4.5)) return candidate;
    }
  }
  return readable;
}
function palette(definition) {
  const { id, name, mode, description, ...base } = definition;
  const tint = visibleStateColor(base.tint, base.bg, base.text);
  const hover = visibleStateColor(base.hover, base.bg, base.text);
  const surfaces = [base.bg, base.paper, base.sidebar, tint, hover];
  const accent = readableColor(base.accent, surfaces);
  const muted = distinctMutedColor(base.muted, surfaces, base.text);
  const tokens = { ...base, accent, tint, hover,
    muted,
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
export const palettes = Object.freeze(definitions.map((definition, index) =>
  palette({ ...definition, name: paletteNames[index] })));
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
export const themePalette = value => {
  const id = resolveTheme(value);
  return palettes.find(p => p.id === id);
};
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
