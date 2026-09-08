import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { FinanceReportForecastCommand } from './finance-report-forecast.command';
import { FinanceReportIncomeCommand } from './finance-report-income.command';
import { FinanceReportSpendCommand } from './finance-report-spend.command';
import { FinanceReportSummaryCommand } from './finance-report-summary.command';

@SubCommand({
  name: 'report',
  description: 'Finance reports',
  subCommands: [
    FinanceReportSummaryCommand,
    FinanceReportForecastCommand,
    FinanceReportIncomeCommand,
    FinanceReportSpendCommand,
  ],
})
export class FinanceReportCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
