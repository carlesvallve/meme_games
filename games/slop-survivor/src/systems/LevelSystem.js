import { UPGRADE_OPTIONS } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { showLevelUpOverlay } from '../scenes/LevelUpScene.js';

export class LevelSystem {
  constructor(scene) {
    this.scene = scene;
    this.pendingLevelUp = false;

    this.onLevelUp = this.onLevelUp.bind(this);
    eventBus.on(Events.LEVEL_UP, this.onLevelUp);
  }

  onLevelUp({ level }) {
    this.pendingLevelUp = true;
    this.scene.scene.pause('GameScene');

    // Show overlay in UIScene (which already renders transparently on top)
    const uiScene = this.scene.scene.get('UIScene');
    if (uiScene) {
      showLevelUpOverlay(uiScene, {
        level: gameState.level,
        options: this.getRandomUpgrades(3),
      });
    }
  }

  getRandomUpgrades(count) {
    const takenIds = gameState.upgrades || [];
    const available = UPGRADE_OPTIONS.filter(opt => {
      if (opt.unique && takenIds.includes(opt.id)) return false;
      return true;
    });

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  destroy() {
    eventBus.off(Events.LEVEL_UP, this.onLevelUp);
  }
}
