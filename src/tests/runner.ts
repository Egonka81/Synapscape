// Automated Unit Test Suite Runner

import { runLIFTests } from './lif.test';
import { runSTDPTests } from './stdp.test';
import { runDeterminismTests } from './determinism.test';

export function runAllTests(): boolean {
  console.log('\n================================================================');
  console.log('                 SYNAPSCAPE SCIENTIFIC UNIT TESTS               ');
  console.log('================================================================\n');

  const lifOk = runLIFTests();
  console.log();
  const stdpOk = runSTDPTests();
  console.log();
  const detOk = runDeterminismTests();

  console.log('\n================================================================');
  if (lifOk && stdpOk && detOk) {
    console.log('  ALL TEST SUITES PASSED (3/3 SUITES OK)');
    console.log('================================================================\n');
    return true;
  } else {
    console.error('  ONE OR MORE TEST SUITES FAILED');
    console.log('================================================================\n');
    return false;
  }
}

if (process.argv[1] && process.argv[1].includes('runner')) {
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}
