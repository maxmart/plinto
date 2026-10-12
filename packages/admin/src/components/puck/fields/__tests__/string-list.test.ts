import { splitItems, joinItems } from '../StringListField';

describe('stringList text', () => {
  it('is one item per line, trimmed, blanks dropped', () => {
    expect(splitItems(' a \n\nb\n', false)).toEqual(['a', 'b']);
  });

  it('with paragraphs, keeps line breaks inside an item', () => {
    expect(splitItems('one\nstill one\n\n  \ntwo', true)).toEqual(['one\nstill one', 'two']);
  });

  it('joins back to text that splits to the same items', () => {
    for (const paragraphs of [false, true]) {
      const items = ['a', 'b c'];
      expect(splitItems(joinItems(items, paragraphs), paragraphs)).toEqual(items);
    }
  });
});
