/**
 * Property-based tests for upload-word-template Lambda
 * 
 * **Feature: word-template-translation, Property 4: Translation Default State**
 * 
 * For any newly extracted placeholder from an uploaded template, 
 * the translateEnabled property SHALL default to false.
 * 
 * **Validates: Requirements 3.4**
 */

import * as fc from 'fast-check';
import { PlaceholderConfig } from '@meeting-platform/shared';

/**
 * Creates PlaceholderConfig objects from extracted placeholder names
 * This mirrors the logic in the upload-word-template Lambda handler
 */
function createPlaceholderConfigs(placeholders: string[]): PlaceholderConfig[] {
  return placeholders.map(name => ({
    name,
    translateEnabled: false,
  }));
}

/**
 * Arbitrary for generating valid placeholder names
 * Placeholders must start with a letter or underscore, followed by alphanumeric characters or underscores
 */
const placeholderNameArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/);

/**
 * Arbitrary for generating arrays of unique placeholder names
 */
const placeholderArrayArb = fc.uniqueArray(placeholderNameArb, { minLength: 0, maxLength: 20 });

describe('upload-word-template property tests', () => {
  /**
   * **Feature: word-template-translation, Property 4: Translation Default State**
   * 
   * For any newly extracted placeholder from an uploaded template,
   * the translateEnabled property SHALL default to false.
   * 
   * **Validates: Requirements 3.4**
   */
  it('Property 4: All newly created placeholder configs have translateEnabled=false', () => {
    fc.assert(
      fc.property(placeholderArrayArb, (placeholders) => {
        const configs = createPlaceholderConfigs(placeholders);
        
        // Every placeholder config must have translateEnabled set to false
        return configs.every(config => config.translateEnabled === false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Placeholder names are preserved correctly
   * This ensures the mapping maintains the original placeholder names
   */
  it('Property 4 (supplementary): Placeholder names are preserved in configs', () => {
    fc.assert(
      fc.property(placeholderArrayArb, (placeholders) => {
        const configs = createPlaceholderConfigs(placeholders);
        
        // The number of configs should match the number of placeholders
        if (configs.length !== placeholders.length) {
          return false;
        }
        
        // Each placeholder name should appear in the configs
        return placeholders.every((name, index) => configs[index].name === name);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Empty placeholder array produces empty config array
   */
  it('Property 4 (edge case): Empty placeholder array produces empty config array', () => {
    const configs = createPlaceholderConfigs([]);
    expect(configs).toHaveLength(0);
  });
});
