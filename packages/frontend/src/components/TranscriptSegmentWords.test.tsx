import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TranscriptSegmentWords } from './TranscriptSegmentWords';
import type { TranscriptSegment } from '@meeting-platform/shared';

describe('TranscriptSegmentWords', () => {
  const mockOnWordClick = vi.fn();

  const createSegmentWithWords = (words: any[]): TranscriptSegment => ({
    startTime: 0,
    endTime: 2000,
    speakerLabel: 'spk_0',
    speakerName: 'John Doe',
    text: words.map(w => w.text).join(' '),
    languageCode: 'en-US',
    confidence: 0.99,
    words,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Word Rendering', () => {
    it('should render individual words when word data is available', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
        { startTime: 600, endTime: 1000, text: 'world', confidence: 0.98 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      expect(wordSpans).toHaveLength(2);
      expect(wordSpans[0].textContent).toBe('Hello');
      expect(wordSpans[1].textContent).toBe('world');
    });

    it('should fallback to segment text when words array is empty', () => {
      const segment: TranscriptSegment = {
        startTime: 0,
        endTime: 2000,
        speakerLabel: 'spk_0',
        text: 'Hello world',
        languageCode: 'en-US',
        confidence: 0.99,
        words: [],
      };

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      expect(container.textContent).toBe('Hello world');
      const wordSpans = container.querySelectorAll('span > span');
      expect(wordSpans).toHaveLength(0);
    });

    it('should fallback to segment text when words array is undefined', () => {
      const segment = {
        startTime: 0,
        endTime: 2000,
        speakerLabel: 'spk_0',
        text: 'Hello world',
        languageCode: 'en-US',
        confidence: 0.99,
        words: undefined as any,
      };

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      expect(container.textContent).toBe('Hello world');
    });
  });

  describe('Active Word Highlighting', () => {
    it('should highlight the active word with gold background', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
        { startTime: 600, endTime: 1000, text: 'world', confidence: 0.98 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={0}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      const activeWord = wordSpans[0] as HTMLElement;
      
      expect(activeWord.style.backgroundColor).toBe('rgb(255, 215, 0)');
      expect(activeWord.style.fontWeight).toBe('600');
      expect(activeWord.style.boxShadow).toBe('0 1px 3px rgba(255, 215, 0, 0.5)');
    });

    it('should not highlight words when segment is not active', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
        { startTime: 600, endTime: 1000, text: 'world', confidence: 0.98 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={0}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      const firstWord = wordSpans[0] as HTMLElement;
      
      expect(firstWord.style.backgroundColor).toBe('transparent');
      expect(firstWord.style.fontWeight).toBe('normal');
    });

    it('should only highlight one word at a time', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
        { startTime: 600, endTime: 1000, text: 'world', confidence: 0.98 },
        { startTime: 1100, endTime: 1500, text: 'test', confidence: 0.97 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={1}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      
      expect((wordSpans[0] as HTMLElement).style.backgroundColor).toBe('transparent');
      expect((wordSpans[1] as HTMLElement).style.backgroundColor).toBe('rgb(255, 215, 0)');
      expect((wordSpans[2] as HTMLElement).style.backgroundColor).toBe('transparent');
    });
  });

  describe('Styling and Visual Effects', () => {
    it('should apply active segment styles when segment is active', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.fontSize).toBe('16px');
      expect(wordSpan.style.fontWeight).toBe('500');
      expect(wordSpan.style.color).toBe('rgb(0, 0, 0)');
    });

    it('should apply inactive segment styles when segment is not active', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.fontSize).toBe('14px');
      expect(wordSpan.style.fontWeight).toBe('normal');
      expect(wordSpan.style.color).toBe('rgb(84, 91, 100)');
    });

    it('should apply transition effect for smooth highlighting', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={0}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.transition).toBe('all 0.1s ease');
    });

    it('should apply cursor pointer for clickable words', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.cursor).toBe('pointer');
    });
  });

  describe('Hover Effects', () => {
    it('should apply hover background on mouse enter for non-active words', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.backgroundColor).toBe('transparent');
      
      fireEvent.mouseEnter(wordSpan);
      expect(wordSpan.style.backgroundColor).toBe('rgb(240, 240, 240)');
    });

    it('should remove hover background on mouse leave for non-active words', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      fireEvent.mouseEnter(wordSpan);
      expect(wordSpan.style.backgroundColor).toBe('rgb(240, 240, 240)');
      
      fireEvent.mouseLeave(wordSpan);
      expect(wordSpan.style.backgroundColor).toBe('transparent');
    });

    it('should not change background on hover for active word', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={0}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      expect(wordSpan.style.backgroundColor).toBe('rgb(255, 215, 0)');
      
      fireEvent.mouseEnter(wordSpan);
      expect(wordSpan.style.backgroundColor).toBe('rgb(255, 215, 0)');
    });
  });

  describe('Word Click Handler', () => {
    it('should call onWordClick with word start time when word is clicked', () => {
      const segment = createSegmentWithWords([
        { startTime: 500, endTime: 1000, text: 'Hello', confidence: 0.99 },
        { startTime: 1100, endTime: 1500, text: 'world', confidence: 0.98 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      
      fireEvent.click(wordSpans[0]);
      expect(mockOnWordClick).toHaveBeenCalledWith(500);
      
      fireEvent.click(wordSpans[1]);
      expect(mockOnWordClick).toHaveBeenCalledWith(1100);
    });

    it('should stop event propagation when word is clicked', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const parentClickHandler = vi.fn();
      const { container } = render(
        <div onClick={parentClickHandler}>
          <TranscriptSegmentWords
            segment={segment}
            isActiveSegment={false}
            activeWordIndex={null}
            onWordClick={mockOnWordClick}
          />
        </div>
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      
      fireEvent.click(wordSpan);
      
      expect(mockOnWordClick).toHaveBeenCalledWith(0);
      expect(parentClickHandler).not.toHaveBeenCalled();
    });

    it('should not call onWordClick when fallback text is rendered', () => {
      const segment: TranscriptSegment = {
        startTime: 0,
        endTime: 2000,
        speakerLabel: 'spk_0',
        text: 'Hello world',
        languageCode: 'en-US',
        confidence: 0.99,
        words: [],
      };

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const textSpan = container.querySelector('span') as HTMLElement;
      
      fireEvent.click(textSpan);
      
      expect(mockOnWordClick).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle segment with single word', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={0}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      expect(wordSpans).toHaveLength(1);
      expect((wordSpans[0] as HTMLElement).style.backgroundColor).toBe('rgb(255, 215, 0)');
    });

    it('should handle segment with many words', () => {
      const words = Array.from({ length: 50 }, (_, i) => ({
        startTime: i * 100,
        endTime: (i + 1) * 100,
        text: `word${i}`,
        confidence: 0.99,
      }));

      const segment = createSegmentWithWords(words);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={25}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      expect(wordSpans).toHaveLength(50);
      expect((wordSpans[25] as HTMLElement).style.backgroundColor).toBe('rgb(255, 215, 0)');
    });

    it('should handle words with special characters', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: "Hello,", confidence: 0.99 },
        { startTime: 600, endTime: 1000, text: "world!", confidence: 0.98 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={false}
          activeWordIndex={null}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpans = container.querySelectorAll('span > span');
      expect(wordSpans[0].textContent).toBe('Hello,');
      expect(wordSpans[1].textContent).toBe('world!');
    });

    it('should handle activeWordIndex of -1', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={-1}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      expect(wordSpan.style.backgroundColor).toBe('transparent');
    });

    it('should handle activeWordIndex beyond array length', () => {
      const segment = createSegmentWithWords([
        { startTime: 0, endTime: 500, text: 'Hello', confidence: 0.99 },
      ]);

      const { container } = render(
        <TranscriptSegmentWords
          segment={segment}
          isActiveSegment={true}
          activeWordIndex={10}
          onWordClick={mockOnWordClick}
        />
      );

      const wordSpan = container.querySelector('span > span') as HTMLElement;
      expect(wordSpan.style.backgroundColor).toBe('transparent');
    });
  });
});
