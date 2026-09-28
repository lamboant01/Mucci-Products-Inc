// Internal browser-slicer defaults. These values are intentionally not shown
// in the customer interface, but browser-side settings are inspectable source.
const shared = Object.freeze({
  auto_center: true,
  first_layer_height: 0.20,
  first_layer_speed: 50,
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
  retract_speed: 40,
  print_speed: 200
});

// Reference values supplied from the owner's Bambu A1 slicer. The bundled
// kernel currently supports first_layer_speed and one general print_speed;
// the remaining values are retained for a future per-feature-speed upgrade.
export const A1_SPEED_REFERENCE = Object.freeze({
  initial_layer:50,
  initial_layer_infill:105,
  outer_wall:200,
  inner_wall:230,
  small_perimeters_percent:50,
  small_perimeter_threshold_mm:0,
  sparse_infill:230,
  internal_solid_infill:230,
  vertical_shell_percent:80
});

export const SLICER_PROFILES = Object.freeze({
  standard: { ...shared, layer_height:0.20 },
  draft: { ...shared, layer_height:0.24 },
  preliminary: { ...shared, wall_loops:4, infill_density:0.30, layer_height:0.20 }
});
