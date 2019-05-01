CREATE EXTERNAL TABLE IF NOT EXISTS contracts_analysis (
    address STRING,
    bytecode STRING,
    function_sighashes STRING,
    is_erc20 BOOLEAN,
    is_erc721 BOOLEAN,
    callstack BOOLEAN,
    reentrancy BOOLEAN,
    time_dependency BOOLEAN,
    integer_overflow BOOLEAN,
    integer_underflow BOOLEAN,
    money_concurrency BOOLEAN,
    evm_code_coverage DECIMAL(4, 2),
    oyente_err BOOLEAN
)
PARTITIONED BY (start_block BIGINT, end_block BIGINT)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
WITH SERDEPROPERTIES (
    'serialization.format' = ',',
    'field.delim' = ',',
    'escape.delim' = '\\'
)
STORED AS TEXTFILE
LOCATION 's3://ethereum-blockchain-analysis-svitali/ethereumetl/export/contracts_analysis'
TBLPROPERTIES (
  'skip.header.line.count' = '1'
);

MSCK REPAIR TABLE contracts_analysis;
