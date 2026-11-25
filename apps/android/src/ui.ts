/**
 * Die Oberfläche ist dieselbe wie unter Windows (`apps/ui`). Dieses Modul lädt sie und reicht
 * die wenigen Haken nach außen, die nur die Android-Hülle braucht.
 */
import '../../ui/src/main';

export { handleBack, onCue } from '../../ui/src/platform';
