/* Stepwell Financial prototype: ONE sample household. Every figure is made up.
   No real people, banks or institutions. Account names are generic.

   SUMS THAT MUST TIE (js/calc.js checkTies() tests all of these):
   1. Each month: group total = sum of its accounts' balances.
   2. Each month: net worth = assets (cash + investments + property)
      - debts (credit cards + loans).
      Oct 2026: 52,145.58 - 23,686.95 = 28,458.63. Sep 2026: 27,246.23.
      Nov 2025 (first month of the 1-year view): 18,498.46.
   3. What changed since 30 Sep = Oct - Sep per account, and the lines add up
      to the change in net worth: +1,212.40 (4.4% of 27,246.23).
   4. Illustration input: average monthly change over the last 6 months =
      (28,458.63 - 23,122.09) / 6 = 889.42 (to the cent).
   5. October spending to 28 Oct, by budget category, = 3,012.00:
      Housing 1,650.00, Groceries 412.00, Eating out 310.00 (14 payments),
      Transport 290.00, Fun 140.00, Other 210.00.
   6. October money in = 5,200.00 (2 x 2,425.00 payroll + 350.00 side work).
   7. Budgets add to 3,350.00. Monthly bills (rent excluded, it sits in the
      Housing budget) add to 1,010.00. October "Bills" lines add to 1,010.00.
   8. Not yet given a job = 5,200.00 - 3,350.00 - 1,010.00 = 840.00.
   9. Fees (fee x-ray stub) add to 195.43; fund cost 6,215.40 x 0.20% = 12.43.

   Known gap, kept from the concept's checked copy: the car loan balance is
   7,840.00 on both 30 Sep and 28 Oct, though an October payment of 310.00 is
   in the transactions. Balances are what the reader typed, so they need not
   follow the transactions. */
(function (root) {
  'use strict';

  var data = {
    asOf: '2026-10-28',
    asOfLabel: 'Wednesday 28 October 2026',
    // Month-end balances; the last month is "today", 28 Oct 2026.
    months: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
             '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],

    groups: [
      { id: 'cash', name: 'Cash', kind: 'asset', token: 'cash', abbr: 'C' },
      { id: 'invest', name: 'Investments', kind: 'asset', token: 'invest', abbr: 'I' },
      { id: 'property', name: 'Property', kind: 'asset', token: 'property', abbr: 'P' },
      { id: 'card', name: 'Credit cards', kind: 'debt', token: 'card', abbr: 'CC' },
      { id: 'loan', name: 'Loans', kind: 'debt', token: 'loan', abbr: 'L' }
    ],

    // Debts are stored as negative balances.
    accounts: [
      { id: 'checking', group: 'cash', name: 'Everyday checking', updated: 'Updated by you on 27 Oct',
        history: [2862.40, 2858.75, 2884.83, 3007.88, 2972.67, 2881.27, 2962.61, 3055.63, 2972.89, 2923.77, 3041.74, 3017.78, 3420.18] },
      { id: 'savings', group: 'cash', name: 'High-yield savings', updated: 'Updated by you on 25 Oct',
        history: [5150.00, 5400.00, 5650.00, 5900.00, 6150.00, 6400.00, 6650.00, 6900.00, 7150.00, 7400.00, 7650.00, 7900.00, 8150.00] },
      { id: 'k401', group: 'invest', name: 'Workplace 401(k)', updated: 'Updated by you on 25 Oct',
        history: [19809.95, 20276.05, 20793.79, 21263.35, 21507.73, 21840.22, 22389.65, 22797.41, 23015.96, 23432.11, 23987.23, 24250.00, 24860.00] },
      { id: 'brokerage', group: 'invest', name: 'Brokerage', updated: 'Updated by you on 25 Oct',
        history: [4980.20, 5105.35, 5230.80, 5361.10, 5402.65, 5480.30, 5622.95, 5710.40, 5755.85, 5860.15, 5990.60, 6075.40, 6215.40] },
      { id: 'car', group: 'property', name: 'Car, your estimate', updated: 'Updated by you on 1 Oct',
        history: [9965.30, 9911.87, 9856.74, 9808.97, 9786.10, 9749.46, 9691.46, 9652.74, 9630.41, 9584.58, 9528.41, 9500.00, 9500.00] },
      { id: 'card4021', group: 'card', name: 'Card ending 4021', updated: 'Updated by you on 27 Oct',
        history: [-637.52, -656.38, -658.65, -682.62, -729.46, -758.50, -768.23, -803.62, -835.39, -864.50, -882.65, -914.55, -1284.55] },
      { id: 'card7730', group: 'card', name: 'Card ending 7730', updated: 'Updated by you on 27 Oct',
        history: [-268.10, -275.40, -290.15, -301.60, -296.35, -288.90, -299.75, -305.20, -310.05, -298.40, -306.85, -312.40, -312.40] },
      { id: 'carloan', group: 'loan', name: 'Car loan', updated: 'Updated by you on 8 Oct',
        history: [-8830.00, -8740.00, -8650.00, -8560.00, -8470.00, -8380.00, -8290.00, -8200.00, -8110.00, -8020.00, -7930.00, -7840.00, -7840.00] },
      { id: 'student', group: 'loan', name: 'Student loan', updated: 'Updated by you on 15 Oct',
        history: [-15540.55, -15381.78, -15218.14, -15103.85, -15093.75, -15007.45, -14836.60, -14763.73, -14750.17, -14623.34, -14466.39, -14430.00, -14250.00] }
    ],

    // Group totals as published in the concept. checkTies() proves the
    // accounts above add up to these, month by month.
    groupTotals: {
      cash: [8012.40, 8258.75, 8534.83, 8907.88, 9122.67, 9281.27, 9612.61, 9955.63, 10122.89, 10323.77, 10691.74, 10917.78, 11570.18],
      invest: [24790.15, 25381.40, 26024.59, 26624.45, 26910.38, 27320.52, 28012.60, 28507.81, 28771.81, 29292.26, 29977.83, 30325.40, 31075.40],
      property: [9965.30, 9911.87, 9856.74, 9808.97, 9786.10, 9749.46, 9691.46, 9652.74, 9630.41, 9584.58, 9528.41, 9500.00, 9500.00],
      card: [-905.62, -931.78, -948.80, -984.22, -1025.81, -1047.40, -1067.98, -1108.82, -1145.44, -1162.90, -1189.50, -1226.95, -1596.95],
      loan: [-24370.55, -24121.78, -23868.14, -23663.85, -23563.75, -23387.45, -23126.60, -22963.73, -22860.17, -22643.34, -22396.39, -22270.00, -22090.00]
    },

    // Published checkpoints the sums must hit.
    expected: {
      netWorth: 28458.63, assets: 52145.58, debts: -23686.95, netWorthSep: 27246.23,
      netWorthNov2025: 18498.46, change: 1212.40, changePct: '4.4', avg6: 889.42,
      spentOct: 3012.00, incomeOct: 5200.00, budgetTotal: 3350.00, billsTotal: 1010.00,
      noJob: 840.00, feesTotal: 195.43
    },

    // Notes shown in "What changed?" (concept wording).
    changeNotes: { k401: 'You updated it on 25 Oct', student: 'You owe less', card4021: 'You owe more' },

    categories: [
      { id: 'housing', name: 'Housing', budget: 1650.00 },
      { id: 'groceries', name: 'Groceries', budget: 550.00 },
      { id: 'eating', name: 'Eating out', budget: 250.00 },
      { id: 'transport', name: 'Transport', budget: 400.00 },
      { id: 'fun', name: 'Fun', budget: 200.00 },
      { id: 'other', name: 'Other', budget: 300.00 },
      { id: 'bills', name: 'Bills', budget: null },
      { id: 'income', name: 'Income', budget: null }
    ],

    // October 2026, 1 to 28 Oct. Money out is negative.
    transactions: [
      { date: '2026-10-01', text: 'Rent', cat: 'housing', amount: -1650.00, account: 'checking' },
      { date: '2026-10-01', text: 'Renters insurance', cat: 'bills', amount: -18.00, account: 'checking' },
      { date: '2026-10-02', text: 'Fuel station', cat: 'transport', amount: -48.50, account: 'card4021' },
      { date: '2026-10-03', text: 'Noodle bar', cat: 'eating', amount: -22.40, account: 'card4021' },
      { date: '2026-10-03', text: 'Transit card top-up', cat: 'transport', amount: -40.00, account: 'checking' },
      { date: '2026-10-04', text: 'Corner Market', cat: 'groceries', amount: -96.42, account: 'card4021' },
      { date: '2026-10-04', text: 'Phone', cat: 'bills', amount: -65.00, account: 'checking' },
      { date: '2026-10-05', text: 'SQ *BLUE DOOR 0427', cat: 'eating', amount: -18.60, account: 'card4021' },
      { date: '2026-10-06', text: 'Cinema', cat: 'fun', amount: -28.00, account: 'card7730' },
      { date: '2026-10-06', text: 'Gym membership', cat: 'bills', amount: -35.00, account: 'checking' },
      { date: '2026-10-07', text: 'Pizza place', cat: 'eating', amount: -31.25, account: 'card4021' },
      { date: '2026-10-08', text: 'Pharmacy', cat: 'other', amount: -23.85, account: 'card4021' },
      { date: '2026-10-08', text: 'Car loan payment', cat: 'bills', amount: -310.00, account: 'checking' },
      { date: '2026-10-09', text: 'Taco stand', cat: 'eating', amount: -14.80, account: 'card4021' },
      { date: '2026-10-10', text: 'Payroll deposit', cat: 'income', amount: 2425.00, account: 'checking' },
      { date: '2026-10-10', text: 'Transit card top-up', cat: 'transport', amount: -40.00, account: 'checking' },
      { date: '2026-10-11', text: 'Corner Market', cat: 'groceries', amount: -88.17, account: 'card4021' },
      { date: '2026-10-11', text: 'Corner café', cat: 'eating', amount: -9.75, account: 'card4021' },
      { date: '2026-10-12', text: 'SQ *BLUE DOOR 0427', cat: 'eating', amount: -18.60, account: 'card4021' },
      { date: '2026-10-12', text: 'Home internet', cat: 'bills', amount: -60.00, account: 'checking' },
      { date: '2026-10-13', text: 'Bookshop', cat: 'fun', amount: -34.50, account: 'card7730' },
      { date: '2026-10-14', text: 'Lunch counter', cat: 'eating', amount: -16.90, account: 'card4021' },
      { date: '2026-10-15', text: 'Haircut', cat: 'other', amount: -38.00, account: 'checking' },
      { date: '2026-10-15', text: 'Student loan payment', cat: 'bills', amount: -340.00, account: 'checking' },
      { date: '2026-10-16', text: 'Pho house', cat: 'eating', amount: -24.35, account: 'card4021' },
      { date: '2026-10-16', text: 'Fuel station', cat: 'transport', amount: -52.30, account: 'card4021' },
      { date: '2026-10-17', text: 'Transit card top-up', cat: 'transport', amount: -40.00, account: 'checking' },
      { date: '2026-10-17', text: 'Hardware store', cat: 'other', amount: -47.65, account: 'card4021' },
      { date: '2026-10-18', text: 'Corner Market', cat: 'groceries', amount: -102.35, account: 'card4021' },
      { date: '2026-10-18', text: 'Bagel shop', cat: 'eating', amount: -8.95, account: 'card4021' },
      { date: '2026-10-18', text: 'Side work, invoice paid', cat: 'income', amount: 350.00, account: 'checking' },
      { date: '2026-10-19', text: 'Harbor grill', cat: 'eating', amount: -67.10, account: 'card4021' },
      { date: '2026-10-19', text: 'Streaming service', cat: 'bills', amount: -15.49, account: 'card4021' },
      { date: '2026-10-20', text: 'Concert tickets', cat: 'fun', amount: -62.00, account: 'card7730' },
      { date: '2026-10-20', text: 'Parking', cat: 'transport', amount: -14.00, account: 'card4021' },
      { date: '2026-10-21', text: 'Corner café', cat: 'eating', amount: -11.40, account: 'card4021' },
      { date: '2026-10-22', text: 'Corner Market', cat: 'groceries', amount: -81.48, account: 'card4021' },
      { date: '2026-10-22', text: 'Gift', cat: 'other', amount: -55.00, account: 'card4021' },
      { date: '2026-10-22', text: 'Electric', cat: 'bills', amount: -90.00, account: 'checking' },
      { date: '2026-10-23', text: 'Pizza place', cat: 'eating', amount: -28.70, account: 'card4021' },
      { date: '2026-10-24', text: 'Transit card top-up', cat: 'transport', amount: -40.00, account: 'checking' },
      { date: '2026-10-24', text: 'Laundry', cat: 'other', amount: -18.50, account: 'checking' },
      { date: '2026-10-25', text: 'SQ *BLUE DOOR 0427', cat: 'eating', amount: -18.60, account: 'card4021' },
      { date: '2026-10-25', text: 'Payroll deposit', cat: 'income', amount: 2425.00, account: 'checking' },
      { date: '2026-10-26', text: 'Board game café', cat: 'fun', amount: -15.50, account: 'card7730' },
      { date: '2026-10-26', text: 'Bike repair', cat: 'transport', amount: -15.20, account: 'card4021' },
      { date: '2026-10-26', text: 'Post office', cat: 'other', amount: -27.00, account: 'checking' },
      { date: '2026-10-27', text: 'Corner Market', cat: 'groceries', amount: -43.58, account: 'card4021' },
      { date: '2026-10-27', text: 'SQ *BLUE DOOR 0427', cat: 'eating', amount: -18.60, account: 'card4021', explain: true },
      { date: '2026-10-28', text: 'Car insurance', cat: 'bills', amount: -76.51, account: 'checking' }
    ],

    // Stubs for later screens.
    bills: [
      { name: 'Rent', day: 1, amount: 1650.00, inBudget: 'housing', note: 'every month' },
      { name: 'Renters insurance', day: 1, amount: 18.00, note: 'every month' },
      { name: 'Phone', day: 4, amount: 65.00, note: 'every month' },
      { name: 'Gym membership', day: 6, amount: 35.00, note: 'every month' },
      { name: 'Car loan', day: 8, amount: 310.00, note: 'every month' },
      { name: 'Home internet', day: 12, amount: 60.00, note: 'every month' },
      { name: 'Student loan', day: 15, amount: 340.00, note: 'every month' },
      { name: 'Streaming service', day: 19, amount: 15.49, note: 'every month' },
      { name: 'Electric', day: 22, amount: 90.00, note: 'amount changes', approx: true },
      { name: 'Car insurance', day: 28, amount: 76.51, note: 'every month' }
    ],
    // The fee lines behind the fee x-ray, as lines in a Fees category (used by
    // "Try with sample data"). All are dated before October, so no October sum
    // changes: 12 monthly fees of 5.00 (60.00) + 95.00 + 28.00 = 183.00, and
    // with the fund cost of 12.43 the x-ray shows 195.43.
    feeLines: [
      { date: '2025-10-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2025-11-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2025-12-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-01-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-02-28', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-03-15', text: 'Yearly card fee', amount: -95.00, account: 'card4021' },
      { date: '2026-03-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-04-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-05-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-06-14', text: 'Late fee', amount: -28.00, account: 'card4021' },
      { date: '2026-06-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-07-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-08-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' },
      { date: '2026-09-30', text: 'Monthly account fee', amount: -5.00, account: 'checking' }
    ],
    fees: [
      { account: 'Everyday checking', what: 'Monthly fee, $5.00 × 12', amount: 60.00 },
      { account: 'Card ending 4021', what: 'Yearly fee, charged in March', amount: 95.00 },
      { account: 'Card ending 4021', what: 'Late fee, 14 Jun', amount: 28.00 },
      { account: 'Brokerage fund costs', what: '0.20% a year (you entered it) on $6,215.40', amount: 12.43, rate: 0.20, base: 6215.40 }
    ],
    goals: [
      { name: 'Emergency fund', target: 12000.00, saved: 8150.00, account: 'savings', typicalMonthlySpend: 3000.00, spendBasis: 'your average for May to Oct' },
      { name: 'Trip to Lisbon', target: 2500.00, saved: 1240.00, by: '2027-06-01' },
      { name: 'New laptop', target: 1800.00, saved: 600.00, by: '2027-03', kind: 'sinking fund' }
    ]
  };

  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.SWData = data;
})(this);
