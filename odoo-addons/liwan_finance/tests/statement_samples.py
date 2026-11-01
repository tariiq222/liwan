# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bank statement files as banks write them (SAR, three lines, closing balance 279.50), for the OFX and CAMT import tests."""

OFX_V1 = '''OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>20261028120000
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS>
<CURDEF>SAR
<BANKACCTFROM>
<BANKID>RJHI
<ACCTID>SA0380000000608010167519
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261025
<DTEND>20261027
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261025120000[+3:AST]
<TRNAMT>750.00
<FITID>2026102500001
<NAME>Transfer from Al Noor
<MEMO>Invoice INV/2026/0001
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261026
<TRNAMT>-460.00
<FITID>2026102600002
<NAME>Gulf Supplies &amp; Co
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20261027
<TRNAMT>-10.50
<FITID>2026102700003
<NAME>Bank fees
<MEMO>Bank fees
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>279.50
<DTASOF>20261027
</LEDGERBAL>
<AVAILBAL>
<BALAMT>250.00
<DTASOF>20261027
</AVAILBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
'''

OFX_V2 = '''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20261028120000</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <STMTRS>
        <CURDEF>SAR</CURDEF>
        <BANKACCTFROM><BANKID>RJHI</BANKID><ACCTID>SA0380000000608010167519</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20261025</DTSTART>
          <DTEND>20261027</DTEND>
          <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261025120000</DTPOSTED><TRNAMT>750.00</TRNAMT><FITID>2026102500001</FITID><NAME>Transfer from Al Noor</NAME><MEMO>Invoice INV/2026/0001</MEMO></STMTTRN>
          <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261026</DTPOSTED><TRNAMT>-460.00</TRNAMT><FITID>2026102600002</FITID><NAME>Gulf Supplies &amp; Co</NAME></STMTTRN>
          <STMTTRN><TRNTYPE>FEE</TRNTYPE><DTPOSTED>20261027</DTPOSTED><TRNAMT>-10.50</TRNAMT><FITID>2026102700003</FITID><NAME>Bank fees</NAME><MEMO>Bank fees</MEMO></STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL><BALAMT>279.50</BALAMT><DTASOF>20261027</DTASOF></LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
'''

CAMT_ENTRY = '''
      <Ntry>
        <Amt Ccy="SAR">{amount}</Amt>
        <CdtDbtInd>{sign}</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>{day}</Dt></BookgDt>
        <ValDt><Dt>{day}</Dt></ValDt>
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>{ref}</AcctSvcrRef></Refs>
            <RmtInf><Ustrd>{text}</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>'''


def camt_balance(code, amount, sign='CRDT', day='2026-10-27'):
    return f'''
      <Bal>
        <Tp><CdOrPrtry><Cd>{code}</Cd></CdOrPrtry></Tp>
        <Amt Ccy="SAR">{amount}</Amt>
        <CdtDbtInd>{sign}</CdtDbtInd>
        <Dt><Dt>{day}</Dt></Dt>
      </Bal>'''


def camt_file(entries, *, opening='1000.00', closing='1279.50', statements=1):
    """A camt.053.001.02 document: ``statements`` copies of one statement, each with the given balances and entries."""
    statement = f'''
    <Stmt>
      <Id>STMT-2026-10-27</Id>
      <CreDtTm>2026-10-28T08:00:00</CreDtTm>
      <Acct><Id><IBAN>SA0380000000608010167519</IBAN></Id><Ccy>SAR</Ccy></Acct>{camt_balance('OPBD', opening, day='2026-10-24')}{camt_balance('CLBD', closing)}{''.join(entries)}
    </Stmt>'''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG-2026-10-28</MsgId><CreDtTm>2026-10-28T08:00:00</CreDtTm></GrpHdr>{statement * statements}
  </BkToCstmrStmt>
</Document>
'''


CAMT = camt_file([
    CAMT_ENTRY.format(amount='750.00', sign='CRDT', day='2026-10-25', ref='BANKREF-1', text='Transfer from Al Noor'),
    CAMT_ENTRY.format(amount='460.00', sign='DBIT', day='2026-10-26', ref='BANKREF-2', text='Gulf Supplies bill'),
    CAMT_ENTRY.format(amount='10.50', sign='DBIT', day='2026-10-27', ref='BANKREF-3', text='Bank fees'),
])
