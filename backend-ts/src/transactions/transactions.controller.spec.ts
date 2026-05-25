import { Test, TestingModule } from '@nestjs/testing';

import { TransactionQueryDto } from './transaction-query.dto';
import { PaginatedTransactionsDto } from './transaction-response.dto';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  const list = jest.fn();

  beforeEach(async () => {
    list.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: { list } }],
    }).compile();
    controller = module.get(TransactionsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to TransactionsService.list with the query DTO', async () => {
    const expected: PaginatedTransactionsDto = {
      data: [],
      pagination: { limit: 50, offset: 0, total: 0 },
    };
    list.mockResolvedValue(expected);
    const query = Object.assign(new TransactionQueryDto(), {
      limit: 50,
      offset: 0,
    });
    const result = await controller.list(query);
    expect(result).toBe(expected);
    expect(list).toHaveBeenCalledWith(query);
  });
});
