import { query } from "./_generated/server";
import { internal } from "./_generated/api";

export const getUserBalances = query({
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);

    /* ————— 1-to-1 expenses ————— */
    const expenses = (await ctx.db.query("expenses").collect()).filter(
      (e) =>
        !e.groupId &&
        (e.paidByUserId === user._id ||
          e.splits.some((s) => s.userId === user._id))
    );

    let youOwe = 0;
    let youAreOwed = 0;
    const balanceByUser = {};

    for (const e of expenses) {
      const isPayer = e.paidByUserId === user._id;
      const mySplit = e.splits.find((s) => s.userId === user._id);

      if (isPayer) {
        for (const s of e.splits) {
          if (s.userId === user._id || s.paid) continue;
          youAreOwed += s.amount;
          (balanceByUser[s.userId] ??= { owed: 0, owing: 0 }).owed += s.amount;
        }
      } else if (mySplit && !mySplit.paid) {
        youOwe += mySplit.amount;
        (balanceByUser[e.paidByUserId] ??= { owed: 0, owing: 0 }).owing +=
          mySplit.amount;
      }
    }

    /* ————— 1-to-1 settlements ————— */
    const settlements = (await ctx.db.query("settlements").collect()).filter(
      (s) =>
        !s.groupId &&
        (s.paidByUserId === user._id || s.receivedByUserId === user._id)
    );

    for (const s of settlements) {
      if (s.paidByUserId === user._id) {
        youOwe -= s.amount;
        (balanceByUser[s.receivedByUserId] ??= { owed: 0, owing: 0 }).owing -=
          s.amount;
      } else {
        youAreOwed -= s.amount;
        (balanceByUser[s.paidByUserId] ??= { owed: 0, owing: 0 }).owed -=
          s.amount;
      }
    }

    /* ————— GROUP BALANCES ————— */
    const groups = await ctx.runQuery(internal.dashboard.getUserGroups);
    const groupOweList = [];
    const groupOwedList = [];

    for (const g of groups) {
      if (g.balance > 0) {
        youAreOwed += g.balance;
        groupOwedList.push({
          groupId: g._id, // ✅ changed from userId
          name: `${g.name} (Group)`,
          imageUrl: g.imageUrl ?? null,
          amount: g.balance,
        });
      } else if (g.balance < 0) {
        youOwe += Math.abs(g.balance);
        groupOweList.push({
          groupId: g._id, // ✅ changed from userId
          name: `${g.name} (Group)`,
          imageUrl: g.imageUrl ?? null,
          amount: Math.abs(g.balance),
        });
      }
    }

    /* ————— Build per-user lists ————— */
    const youOweList = [];
    const youAreOwedList = [];

    for (const [uid, { owed, owing }] of Object.entries(balanceByUser)) {
      const net = owed - owing;
      if (net === 0) continue;

      const counterpart = await ctx.db.get(uid);
      const base = {
        userId: uid,
        name: counterpart?.name ?? "Unknown",
        imageUrl: counterpart?.imageUrl,
        amount: Math.abs(net),
      };

      net > 0 ? youAreOwedList.push(base) : youOweList.push(base);
    }

    // Merge group debts/credits (already using groupId so no Convex error)
    youOweList.push(...groupOweList);
    youAreOwedList.push(...groupOwedList);

    // Sort
    youOweList.sort((a, b) => b.amount - a.amount);
    youAreOwedList.sort((a, b) => b.amount - a.amount);

    return {
      youOwe,
      youAreOwed,
      totalBalance: youAreOwed - youOwe,
      oweDetails: {
        youOwe: youOweList,
        youAreOwedBy: youAreOwedList,
      },
    };
  },
});

export const getTotalSpent = query({
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);

    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1).getTime();

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_date", (q) => q.gte("date", startOfYear))
      .collect();

    const userExpenses = expenses.filter(
      (expense) =>
        expense.paidByUserId === user._id ||
        expense.splits.some((split) => split.userId === user._id)
    );

    let totalSpent = 0;

    userExpenses.forEach((expense) => {
      const userSplit = expense.splits.find(
        (split) => split.userId === user._id
      );

      if (userSplit) {
        totalSpent += userSplit.amount;
      }
    });

    return totalSpent;
  },
});

export const getMonthlySpending = query({
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);

    // Get current year and its start timestamp
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1).getTime();

    // Get all expenses for current year
    const allExpenses = await ctx.db
      .query("expenses")
      .withIndex("by_date", (q) => q.gte("date", startOfYear))
      .collect();

    const userExpenses = allExpenses.filter(
      (expense) =>
        expense.paidByUserId === user._id ||
        expense.splits.some((split) => split.userId === user._id)
    );

    const monthlyTotals = {};
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(currentYear, i, 1);
      monthlyTotals[monthDate.getTime()] = 0;
    }

    userExpenses.forEach((expense) => {
      const date = new Date(expense.date);

      const monthStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        1
      ).getTime();

      const userSplit = expense.splits.find(
        (split) => split.userId === user._id
      );

      if (userSplit) {
        monthlyTotals[monthStart] =
          (monthlyTotals[monthStart] || 0) + userSplit.amount;
      }
    });

    const result = Object.entries(monthlyTotals).map(([month, total]) => ({
      month: parseInt(month),
      total,
    }));

    result.sort((a, b) => a.month - b.month);
    return result;
  },
});

export const getUserGroups = query({
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);

    // Get all groups from the database
    const allGroups = await ctx.db.query("groups").collect();

    // Filter to only include groups where the user is a member
    const groups = allGroups.filter((group) =>
      group.members.some((member) => member.userId === user._id)
    );

    const enhancedGroups = await Promise.all(
      groups.map(async (group) => {
        // Get all expenses for this specific group
        const expenses = await ctx.db
          .query("expenses")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();

        let balance = 0;

        //calculate balance from expenses
        expenses.forEach((expense) => {
          if (expense.paidByUserId === user._id) {
            // User paid for the expense - others may owe them
            expense.splits.forEach((split) => {
              // Add amounts others owe to the user (excluding user's own split and paid splits)
              if (split.userId !== user._id && !split.paid) {
                balance += split.amount;
              }
            });
          } else {
            // Someone else paid - user may owe them
            const userSplit = expense.splits.find(
              (split) => split.userId === user._id
            );
            // Subtract amounts the user owes others
            if (userSplit && !userSplit.paid) {
              balance -= userSplit.amount;
            }
          }
        });

        //apply settlements to adjust the balance
        const settlements = await ctx.db
          .query("settlements")
          .filter((q) =>
            q.and(
              q.eq(q.field("groupId"), group._id),
              q.or(
                q.eq(q.field("paidByUserId"), user._id),
                q.eq(q.field("receivedByUserId"), user._id)
              )
            )
          )
          .collect();

        settlements.forEach((settlement) => {
          if (settlement.paidByUserId === user._id) {
            // User paid someone in the group - increases user's balance
            balance += settlement.amount;
          } else {
            // Someone paid the user - decreases user's balance
            balance -= settlement.amount;
          }
        });

        return {
          ...group,
          id: group._id,
          balance,
        };
      })
    );

    return enhancedGroups;
  },
});
