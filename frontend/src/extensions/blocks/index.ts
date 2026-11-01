import { register } from '../registry';
import { replaceGroup } from './registry';
import { SNIPPETS } from './snippets';

export * from './registry';

register({
  id: 'blocks',
  name: 'Blocks',
  description: 'Semantic HTML snippets for the editor cursor, and the block registry the Studio palette reads.',
  setup(): void {
    replaceGroup('snippet', SNIPPETS);
  },
});
