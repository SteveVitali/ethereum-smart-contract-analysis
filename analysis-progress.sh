#!/bin/bash

# Note: script is meant to be run when START_BLOCK + BATCH_SIZE == END_BLOCK
#       i.e., script is meant for single-batch analysis jobs

cat nohup.out

echo "Total Analysis Progress:"
ls ethereumetl/export/contracts_analysis

echo "Analyzing range: ${START_BLOCK} - ${END_BLOCK}"

CONTRACTS=ethereumetl/export/contracts
START=start_block=0${START_BLOCK}
END=end_block=0${END_BLOCK}
CSV=contracts_0${START_BLOCK}_0${END_BLOCK}.csv

echo "Num Contracts in ${START_BLOCK}:"
wc -l ${CONTRACTS}/${START}/${END}/${CSV}