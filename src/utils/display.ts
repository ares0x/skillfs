import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';

/**
 * Replaces the absolute user home path in a string with '~' for cleaner terminal output.
 */
export function formatPath(filePath: string): string {
  const home = process.env.SKILLFS_HOME_OVERRIDE || os.homedir();
  const normalizedPath = path.normalize(filePath);
  if (normalizedPath.startsWith(home)) {
    return normalizedPath.replace(home, '~');
  }
  return normalizedPath;
}

/**
 * Standard log functions with colored outputs.
 */
export const display = {
  success: (message: string) => {
    console.log(chalk.green(`  ✓ ${message}`));
  },
  
  warn: (message: string) => {
    console.log(chalk.yellow(`  ⚠ ${message}`));
  },
  
  error: (message: string) => {
    console.log(chalk.red(`  × ${message}`));
  },
  
  info: (message: string) => {
    console.log(chalk.cyan(`  ℹ ${message}`));
  },

  dim: (message: string) => {
    console.log(chalk.gray(`    ${message}`));
  },

  header: (title: string) => {
    console.log(`\n${chalk.bold.magenta(title)}\n`);
  },

  bold: (message: string) => {
    return chalk.bold(message);
  },

  green: (message: string) => {
    return chalk.green(message);
  },

  yellow: (message: string) => {
    return chalk.yellow(message);
  },

  red: (message: string) => {
    return chalk.red(message);
  },

  gray: (message: string) => {
    return chalk.gray(message);
  },

  cyan: (message: string) => {
    return chalk.cyan(message);
  }
};
