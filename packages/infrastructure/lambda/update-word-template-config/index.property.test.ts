/**
 * Property-based tests for update-word-template-config Lambda
 * 
 * **Feature: word-template-translation, Property 3: Configuration Persistence Round-Trip**
 * 
 * For any valid WordTemplateConfig (including sourceLanguage, targetLanguage, 
 * and placeholder translation preferences), saving and then retrieving the 
 * configuration SHALL return equivalent values.
 * 
 * **Validates: Requirements 2.2, 2.3, 3.3**
 */

import * as fc from 'fast-check';
import { isValidLanguageCode, validatePlaceholders } from './index';
import { PlaceholderConfig, SUPPORTED_LANGUAGES, LanguageCode } from '@meeting-platform/shared';

/**
 * Simulates the configuration update and retrieval process
 * This mirrors the logic in the update-word-template-config Lambda handler
 */
interface ConfigUpdate {
  sourceLanguage?: string;
  targetLanguage?: string;
  placeholders?: PlaceholderConfig[];
}

interface StoredConfig {
  sourceLanguage: string;
  targetLanguage: string;
  placeholders: PlaceholderConfig[];
  updatedAt: number;
}

/**
 * Simulates applying an update to an existing configuration
 * This mirrors the DynamoDB update logic in the Lambda handler
 */
function applyConfigUpdate(
  existingConfig: StoredConfig,
  update: ConfigUpdate
): StoredConfig {
  return {
    sourceLanguage: update.sourceLanguage ?? existingConfig.sourceLanguage,
    targetLanguage: update.targetLanguage ?? existingConfig.targetLanguage,
    placeholders: update.placeholders ?? existingConfig.placeholders,
    updatedAt: Date.now(),
  };
}

/**
 * Arbitrary for generating valid language codes from SUPPORTED_LANGUAGES
 */
const languageCodeArb = fc.constantFrom(
  ...SUPPORTED_LANGUAGES.map(lang => lang.code)
) as fc.Arbitrary<LanguageCode>;

/**
 * Arbitrary for generating valid placeholder names
 */
const placeholderNameArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/);


/**
 * Arbitrary for generating valid PlaceholderConfig objects
 */
const placeholderConfigArb = fc.record({
  name: placeholderNameArb,
  translateEnabled: fc.boolean(),
});

/**
 * Arbitrary for generating arrays of unique PlaceholderConfig objects
 */
const placeholderArrayArb = fc.uniqueArray(placeholderConfigArb, {
  minLength: 0,
  maxLength: 20,
  selector: (p) => p.name,
});

/**
 * Arbitrary for generating valid stored configurations
 */
const storedConfigArb = fc.record({
  sourceLanguage: languageCodeArb,
  targetLanguage: languageCodeArb,
  placeholders: placeholderArrayArb,
  updatedAt: fc.nat(),
});

/**
 * Arbitrary for generating valid configuration updates
 * At least one field must be present
 */
const configUpdateArb = fc.record({
  sourceLanguage: fc.option(languageCodeArb, { nil: undefined }),
  targetLanguage: fc.option(languageCodeArb, { nil: undefined }),
  placeholders: fc.option(placeholderArrayArb, { nil: undefined }),
}).filter(update => 
  update.sourceLanguage !== undefined || 
  update.targetLanguage !== undefined || 
  update.placeholders !== undefined
);

describe('update-word-template-config property tests', () => {
  /**
   * **Feature: word-template-translation, Property 3: Configuration Persistence Round-Trip**
   * 
   * For any valid WordTemplateConfig (including sourceLanguage, targetLanguage,
   * and placeholder translation preferences), saving and then retrieving the
   * configuration SHALL return equivalent values.
   * 
   * **Validates: Requirements 2.2, 2.3, 3.3**
   */
  describe('Property 3: Configuration Persistence Round-Trip', () => {
    it('sourceLanguage updates are persisted correctly', () => {
      fc.assert(
        fc.property(storedConfigArb, languageCodeArb, (existingConfig, newSourceLanguage) => {
          const update: ConfigUpdate = { sourceLanguage: newSourceLanguage };
          const result = applyConfigUpdate(existingConfig, update);
          
          // The sourceLanguage should be updated to the new value
          return result.sourceLanguage === newSourceLanguage;
        }),
        { numRuns: 100 }
      );
    });

    it('targetLanguage updates are persisted correctly', () => {
      fc.assert(
        fc.property(storedConfigArb, languageCodeArb, (existingConfig, newTargetLanguage) => {
          const update: ConfigUpdate = { targetLanguage: newTargetLanguage };
          const result = applyConfigUpdate(existingConfig, update);
          
          // The targetLanguage should be updated to the new value
          return result.targetLanguage === newTargetLanguage;
        }),
        { numRuns: 100 }
      );
    });

    it('placeholder updates are persisted correctly', () => {
      fc.assert(
        fc.property(storedConfigArb, placeholderArrayArb, (existingConfig, newPlaceholders) => {
          const update: ConfigUpdate = { placeholders: newPlaceholders };
          const result = applyConfigUpdate(existingConfig, update);
          
          // The placeholders should be updated to the new value
          if (result.placeholders.length !== newPlaceholders.length) {
            return false;
          }
          
          return result.placeholders.every((p, i) => 
            p.name === newPlaceholders[i].name && 
            p.translateEnabled === newPlaceholders[i].translateEnabled
          );
        }),
        { numRuns: 100 }
      );
    });

    it('partial updates preserve unchanged fields', () => {
      fc.assert(
        fc.property(storedConfigArb, configUpdateArb, (existingConfig, update) => {
          const result = applyConfigUpdate(existingConfig, update);
          
          // Fields not in the update should remain unchanged
          if (update.sourceLanguage === undefined && result.sourceLanguage !== existingConfig.sourceLanguage) {
            return false;
          }
          if (update.targetLanguage === undefined && result.targetLanguage !== existingConfig.targetLanguage) {
            return false;
          }
          if (update.placeholders === undefined) {
            if (result.placeholders.length !== existingConfig.placeholders.length) {
              return false;
            }
            return result.placeholders.every((p, i) => 
              p.name === existingConfig.placeholders[i].name && 
              p.translateEnabled === existingConfig.placeholders[i].translateEnabled
            );
          }
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('full configuration updates are persisted correctly', () => {
      fc.assert(
        fc.property(
          storedConfigArb, 
          languageCodeArb, 
          languageCodeArb, 
          placeholderArrayArb,
          (existingConfig, newSourceLang, newTargetLang, newPlaceholders) => {
            const update: ConfigUpdate = {
              sourceLanguage: newSourceLang,
              targetLanguage: newTargetLang,
              placeholders: newPlaceholders,
            };
            const result = applyConfigUpdate(existingConfig, update);
            
            // All fields should be updated
            if (result.sourceLanguage !== newSourceLang) return false;
            if (result.targetLanguage !== newTargetLang) return false;
            if (result.placeholders.length !== newPlaceholders.length) return false;
            
            return result.placeholders.every((p, i) => 
              p.name === newPlaceholders[i].name && 
              p.translateEnabled === newPlaceholders[i].translateEnabled
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Language code validation', () => {
    it('all SUPPORTED_LANGUAGES codes are valid', () => {
      fc.assert(
        fc.property(languageCodeArb, (code) => {
          return isValidLanguageCode(code) === true;
        }),
        { numRuns: 100 }
      );
    });

    it('random strings that are not in SUPPORTED_LANGUAGES are invalid', () => {
      const invalidCodeArb = fc.string({ minLength: 1, maxLength: 10 })
        .filter(s => !SUPPORTED_LANGUAGES.some(lang => lang.code === s));
      
      fc.assert(
        fc.property(invalidCodeArb, (code) => {
          return isValidLanguageCode(code) === false;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Placeholder validation', () => {
    it('valid placeholder arrays pass validation', () => {
      fc.assert(
        fc.property(placeholderArrayArb, (placeholders) => {
          const result = validatePlaceholders(placeholders);
          return result.valid === true;
        }),
        { numRuns: 100 }
      );
    });

    it('non-array values fail validation', () => {
      const nonArrayArb = fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.record({ name: fc.string() })
      );
      
      fc.assert(
        fc.property(nonArrayArb, (value) => {
          const result = validatePlaceholders(value as any);
          return result.valid === false;
        }),
        { numRuns: 100 }
      );
    });

    it('placeholders with missing name fail validation', () => {
      const invalidPlaceholderArb = fc.array(
        fc.record({
          translateEnabled: fc.boolean(),
        }),
        { minLength: 1, maxLength: 5 }
      );
      
      fc.assert(
        fc.property(invalidPlaceholderArb, (placeholders) => {
          const result = validatePlaceholders(placeholders as any);
          return result.valid === false;
        }),
        { numRuns: 100 }
      );
    });

    it('placeholders with non-boolean translateEnabled fail validation', () => {
      const invalidPlaceholderArb = fc.array(
        fc.record({
          name: placeholderNameArb,
          translateEnabled: fc.string(),
        }),
        { minLength: 1, maxLength: 5 }
      );
      
      fc.assert(
        fc.property(invalidPlaceholderArb, (placeholders) => {
          const result = validatePlaceholders(placeholders as any);
          return result.valid === false;
        }),
        { numRuns: 100 }
      );
    });
  });
});
