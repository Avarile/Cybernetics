// One module's contact: the blip it shows on the scanner deck, and the tether
// tying that blip back up to its strip.
//
// Rendered as a child of the strip's own group rather than parented into the
// scanner. The reference kept them in separate branches and synced the
// contact's bearing to the strip's every frame; nesting makes the transform
// hierarchy do that instead, so there is nothing to keep in step and no chance
// of the two drifting a frame apart. The cost is one offset: the group sits at
// -reach in the strip's space, which lands it exactly on the deck.
//
// Mesh names come from the id, not the label, so they survive a rename.

import { SCANNER } from '../scene/config';
import type { ModuleMaterials } from '../scene/materials';

export interface ContactSpec {
  /** Names every mesh in the contact. Identity, not display text. */
  id: string;
  /** The strip's radius — contacts sit further out for wider modules. */
  radius: number;
  /** The strip's height, which is how far the tether has to reach. */
  y: number;
  /** Which ring of the deck this contact stands on. */
  lane: number;
}

interface ContactProps {
  spec: ContactSpec;
  mats: ModuleMaterials;
  /** Follows the deck: hiding the scanner hides its contacts with it. */
  visible: boolean;
  picked: boolean;
}

export default function Contact({ spec, mats, visible, picked }: ContactProps) {
  const { id, radius, y } = spec;
  const reach = y - SCANNER.y;

  // Contacts sit further out for wider modules, echoing the strip's own radius.
  // The lane comes from the scene's runtime state, not from a list position, so
  // deleting one module never shifts everyone else's contact in or out.
  const d = 0.42 + (radius + 2.62) * 1.55 + spec.lane * 0.3;

  return (
    <group name={`${id}-contact`} position-y={-reach} visible={visible}>
      <mesh name={`${id}-blip`} material={mats.band} position={[d, 0.012, 0]}>
        <octahedronGeometry args={[0.05]} />
      </mesh>
      <mesh name={`${id}-tether`} material={mats.glow} position={[d, reach / 2, 0]}>
        <cylinderGeometry args={[0.0035, 0.0035, reach, 6]} />
      </mesh>
      {/* Selection marker: a ring on the plate around the dot, a brighter twin
          of the dot, and a beam up the tether, so the pairing between contact
          and strip reads as one object. */}
      <group name={`${id}-select`} visible={picked}>
        <mesh
          name={`${id}-select-ring`}
          material={mats.mark}
          position={[d, 0.014, 0]}
          rotation-x={-Math.PI / 2}
        >
          <ringGeometry args={[0.082, 0.104, 44]} />
        </mesh>
        <mesh name={`${id}-select-blip`} material={mats.hot} position={[d, 0.012, 0]}>
          <octahedronGeometry args={[0.062]} />
        </mesh>
        <mesh name={`${id}-select-beam`} material={mats.mark} position={[d, reach / 2, 0]}>
          <cylinderGeometry args={[0.008, 0.008, reach, 8]} />
        </mesh>
      </group>
    </group>
  );
}
