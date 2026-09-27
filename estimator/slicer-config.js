// Internal browser-slicer defaults. These values are intentionally not shown
// in the customer interface, but browser-side settings are inspectable source.
const shared = Object.freeze({
  auto_center: true,
  first_layer_height: 0.20,
  line_width: 0.42,
  wall_loops: 3,
  infill_density: 0.30,
  sparse_infill_pattern: "grid",
  top_shell_layers: 4,
  bottom_shell_layers: 4,
  enable_support: false,
  nozzle_diameter: 0.4,
  filament_diameter: 1.75,
  bed_width: 250,
  bed_depth: 250,
  bed_height: 250,
  printable_height: 250,
  travel_speed: 150,
  nozzle_temp: 205,
  bed_temp: 60,
  retract_length: 1.5,
  retract_speed: 40
});

export const SLICER_PROFILES = Object.freeze({
  standard: { ...shared, layer_height:0.20, print_speed:50 },
  draft: { ...shared, layer_height:0.24, print_speed:60 }
});
