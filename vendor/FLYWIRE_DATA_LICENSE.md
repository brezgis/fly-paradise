# FlyWire data notice

`js/brain.data.js` is derived from the published FlyWire FAFB v783 data
products downloaded from FlyWire Codex. Published FlyWire data is available
under the Creative Commons Attribution-NonCommercial 4.0 International
license (CC BY-NC 4.0):

https://creativecommons.org/licenses/by-nc/4.0/

Source data:

- FlyWire Codex FAFB v783: https://codex.flywire.ai/api/download?dataset=fafb
- FlyWire Principles and data terms: https://edit.flywire.ai/principles.html

Changes made for Fly Paradise:

- selected the first Codex representative coordinate for each proofread neuron;
- transformed, robustly normalized, and quantized those coordinates;
- grouped points using published classification and annotation fields;
- retained connection endpoints with at least 100 synapses for display; and
- aggregated connections with at least five synapses into an 8×8 activity matrix.

Please cite:

- Dorkenwald, S. et al. “Neuronal wiring diagram of an adult brain.” Nature
  634, 124–138 (2024). https://doi.org/10.1038/s41586-024-07558-y
- Schlegel, P. et al. “Whole-brain annotation and multi-connectome cell typing
  of Drosophila.” Nature 634, 139–152 (2024).
  https://doi.org/10.1038/s41586-024-07686-5
